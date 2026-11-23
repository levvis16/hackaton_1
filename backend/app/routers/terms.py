"""Terms API: терминологический модуль."""
import json
import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .. import models, schemas
from ..config import EXPORT_DIR
from ..database import get_db
from ..deps import require_any, require_annotator, require_verifier, token_or_header_user
from ..services.audit import log

router = APIRouter(prefix="/terms", tags=["terms"])


def _term_out(t: models.Term) -> schemas.TermOut:
    return schemas.TermOut(
        id=t.id, project_id=t.project_id, value=t.value,
        normalized_value=t.normalized_value, type=t.type, status=t.status,
        comment=t.comment, suggested_variant=t.suggested_variant, created_at=t.created_at,
    )


def normalize_term(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


@router.get("/project/{project_id}", response_model=list[schemas.TermOut])
def list_terms(
    project_id: int,
    status: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_any),
):
    q = db.query(models.Term).filter(models.Term.project_id == project_id)
    if status:
        q = q.filter(models.Term.status == status)
    if search:
        q = q.filter(models.Term.value.ilike(f"%{search}%"))
    terms = q.order_by(models.Term.id.desc()).all()
    return [_term_out(t) for t in terms]


@router.post("", response_model=schemas.TermOut)
def create_term(data: schemas.TermIn, db: Session = Depends(get_db), user: models.User = Depends(require_annotator)):
    existing = db.query(models.Term).filter(
        models.Term.project_id == data.project_id,
        models.Term.normalized_value == normalize_term(data.value),
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Термин уже существует в словаре")

    term = models.Term(
        project_id=data.project_id,
        value=data.value.strip(),
        normalized_value=normalize_term(data.value),
        type=data.type,
        comment=data.comment,
        suggested_variant=data.suggested_variant,
        status="new",
        created_by=user.id,
    )
    db.add(term)
    db.commit()
    db.refresh(term)
    log(db, user, "term", term.id, "create", new_value=term.value)
    return _term_out(term)


@router.put("/{term_id}", response_model=schemas.TermOut)
def update_term(
    term_id: int,
    data: schemas.TermUpdate,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_annotator),
):
    term = db.get(models.Term, term_id)
    if term is None:
        raise HTTPException(status_code=404, detail="Термин не найден")
    changes = data.model_dump(exclude_unset=True)
    for field, value in changes.items():
        if value is not None:
            setattr(term, field, value)
    if "value" in changes and changes["value"]:
        term.normalized_value = normalize_term(changes["value"])
    db.commit()
    db.refresh(term)
    log(db, user, "term", term.id, "update", new_value=json.dumps(changes, ensure_ascii=False))
    return _term_out(term)


@router.post("/{term_id}/approve", response_model=schemas.TermOut)
def approve_term(term_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_verifier)):
    term = db.get(models.Term, term_id)
    if term is None:
        raise HTTPException(status_code=404, detail="Термин не найден")
    term.status = "approved"
    db.commit()
    log(db, user, "term", term.id, "approve")
    return _term_out(term)


@router.post("/{term_id}/reject", response_model=schemas.TermOut)
def reject_term(term_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_verifier)):
    term = db.get(models.Term, term_id)
    if term is None:
        raise HTTPException(status_code=404, detail="Термин не найден")
    term.status = "rejected"
    db.commit()
    log(db, user, "term", term.id, "reject")
    return _term_out(term)


@router.post("/project/{project_id}/import")
def import_terms(
    project_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: models.User = Depends(require_annotator),
):
    """Импорт словаря терминов (JSON или txt, по одному термину на строку)."""
    try:
        raw = file.file.read().decode("utf-8")
    except Exception:
        raise HTTPException(status_code=400, detail="Не удалось прочитать файл")

    count = 0
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            values = [str(x) for x in data]
        elif isinstance(data, dict):
            values = [str(x) for x in data.get("terms", [])]
        else:
            values = []
    except Exception:
        values = [line.strip() for line in raw.splitlines() if line.strip()]

    for value in values:
        norm = normalize_term(value)
        if not norm:
            continue
        existing = db.query(models.Term).filter(
            models.Term.project_id == project_id,
            models.Term.normalized_value == norm,
        ).first()
        if existing:
            continue
        db.add(models.Term(project_id=project_id, value=value, normalized_value=norm, status="new", created_by=user.id))
        count += 1
    db.commit()
    log(db, user, "project", project_id, "import_terms", new_value=f"{count} terms")
    return {"ok": True, "imported": count}


@router.get("/project/{project_id}/export")
def export_terms(project_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_any)):
    """Экспорт списка спорных терминов."""
    terms = db.query(models.Term).filter(models.Term.project_id == project_id).all()
    data = {
        "project_id": project_id,
        "exported_at": __import__("datetime").datetime.now().isoformat(),
        "terms": [
            {
                "value": t.value,
                "type": t.type,
                "status": t.status,
                "comment": t.comment,
                "suggested_variant": t.suggested_variant,
            }
            for t in terms
        ],
    }
    filename = f"terms_project_{project_id}.json"
    path = EXPORT_DIR / filename
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "path": str(path), "count": len(terms), "filename": filename}


@router.get("/project/{project_id}/export/download", response_class=FileResponse)
def download_terms_export(
    project_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(token_or_header_user),
):
    """Скачивание файла экспорта терминов (поддерживает token в query)."""
    path = EXPORT_DIR / f"terms_project_{project_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Сначала выполните экспорт терминов")
    return FileResponse(path, filename=path.name, media_type="application/json")
