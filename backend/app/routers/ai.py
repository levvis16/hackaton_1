"""AI API: подсказки AI-помощника (mock)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..deps import require_any
from ..services.ai_assistant import generate_hints

router = APIRouter(prefix="/ai", tags=["ai"])


@router.get("/hints/{task_id}")
def get_hints(task_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_any)):
    task = db.get(models.Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    segments = db.query(models.Segment).filter(models.Segment.task_id == task_id).all()
    hints = generate_hints(task, segments)
    return [h.model_dump() for h in hints]


@router.get("/suggest/{task_id}")
def suggest_fixes(task_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_any)):
    """Предлагает варианты исправлений (не применяет автоматически)."""
    task = db.get(models.Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    segments = db.query(models.Segment).filter(models.Segment.task_id == task_id).all()
    hints = generate_hints(task, segments)
    suggestions = [
        {
            "segment_id": h.segment_id,
            "type": h.type,
            "message": h.message,
            "suggestion": h.suggestion,
        }
        for h in hints
        if h.suggestion
    ]
    return suggestions
