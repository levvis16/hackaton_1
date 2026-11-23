"""Export API: экспорт JSON, отчётов, скачивание."""
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import require_any, require_supervisor, token_or_header_user
from ..services.audit import log
from ..services.export_service import (
    build_gecko_json,
    build_ml_json,
    build_report,
    save_export,
)

router = APIRouter(prefix="/tasks", tags=["export"])


@router.post("/{task_id}/export/json")
def export_json(task_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_supervisor)):
    task = db.get(models.Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    data = build_gecko_json(task)
    export = save_export(task, db, "gecko_json", data)
    task.status = "exported"
    db.commit()
    log(db, user, "task", task_id, "export_json", new_value=str(export.id))
    return {"ok": True, "export_id": export.id, "path": export.path}


@router.post("/{task_id}/export/ml")
def export_ml(task_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_supervisor)):
    task = db.get(models.Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    data = build_ml_json(task)
    export = save_export(task, db, "ml_json", data)
    log(db, user, "task", task_id, "export_ml", new_value=str(export.id))
    return {"ok": True, "export_id": export.id, "path": export.path}


@router.post("/{task_id}/export/report")
def export_report(task_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_supervisor)):
    task = db.get(models.Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    data = build_report(task, db)
    export = save_export(task, db, "report", data)
    log(db, user, "task", task_id, "export_report", new_value=str(export.id))
    return {"ok": True, "export_id": export.id, "path": export.path}


@router.get("/exports/{export_id}", response_class=FileResponse)
def download_export(export_id: int, db: Session = Depends(get_db), user: models.User = Depends(token_or_header_user)):
    export = db.get(models.ExportFile, export_id)
    if export is None:
        raise HTTPException(status_code=404, detail="Экспорт не найден")
    path = Path(export.path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Файл не найден на диске")
    return FileResponse(path, filename=path.name, media_type="application/json")


@router.get("/{task_id}/exports", response_model=list[schemas.ExportOut])
def list_exports(task_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_any)):
    exports = db.query(models.ExportFile).filter(models.ExportFile.task_id == task_id).order_by(models.ExportFile.id.desc()).all()
    return exports
