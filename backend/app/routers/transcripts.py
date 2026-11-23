"""Transcripts API: версии транскрипции, история правок, восстановление."""
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import require_any, require_supervisor
from ..services.audit import log
from ..services.export_service import build_gecko_json

router = APIRouter(prefix="/tasks", tags=["transcripts"])


@router.get("/{task_id}/transcript")
def get_transcript(task_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_any)):
    task = db.get(models.Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    return build_gecko_json(task)


@router.get("/{task_id}/versions")
def get_versions(task_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_any)):
    versions = db.query(models.Transcript).filter(models.Transcript.task_id == task_id).order_by(models.Transcript.id.desc()).all()
    return [
        {
            "id": v.id,
            "version": v.version,
            "created_at": v.created_at.isoformat() if v.created_at else None,
            "segment_count": len(json.loads(v.current_json or "{}").get("segments", [])) if v.current_json else 0,
        }
        for v in versions
    ]


@router.post("/{task_id}/restore")
def restore_version(
    task_id: int,
    data: dict,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_supervisor),
):
    version_id = data.get("version_id")
    task = db.get(models.Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    version = db.get(models.Transcript, version_id) if version_id else None
    if version is None or version.task_id != task_id:
        raise HTTPException(status_code=404, detail="Версия не найдена")

    data_json = json.loads(version.current_json or "{}")
    segments = data_json.get("segments", [])

    db.query(models.Segment).filter(models.Segment.task_id == task_id).delete()
    for i, item in enumerate(segments):
        db.add(models.Segment(
            task_id=task_id,
            start_time=float(item.get("start", 0)),
            end_time=float(item.get("end", 1)),
            text=item.get("text", ""),
            speaker_name=item.get("speaker", ""),
            confidence=float(item.get("confidence", 1.0) or 1.0),
            is_crosstalk=bool(item.get("is_crosstalk", False)),
            order_index=i,
        ))
    db.commit()
    log(db, user, "task", task_id, "restore_version", new_value=f"version={version.id}")
    return {"ok": True}


@router.get("/{task_id}/source-segments")
def get_source_segments(task_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_any)):
    """Сегменты исходной предразметки (для сравнения верификатором)."""
    task = db.get(models.Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    if not task.source_json:
        return []
    try:
        data = json.loads(task.source_json)
    except Exception:
        return []
    if isinstance(data, list):
        return data
    return data.get("segments", [])


@router.get("/{task_id}/segment-edits")
def get_segment_edits(task_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_any)):
    seg_ids = [s.id for s in db.query(models.Segment).filter(models.Segment.task_id == task_id).all()]
    if not seg_ids:
        return []
    edits = db.query(models.SegmentEdit).filter(models.SegmentEdit.segment_id.in_(seg_ids)).order_by(models.SegmentEdit.id.desc()).limit(200).all()
    return [
        {
            "id": e.id,
            "segment_id": e.segment_id,
            "user_id": e.user_id,
            "field": e.field,
            "old_value": e.old_value,
            "new_value": e.new_value,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in edits
    ]
