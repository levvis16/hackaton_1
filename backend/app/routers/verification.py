"""Verification API: комментарии, возврат на доработку, приёмка."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import require_annotator, require_any, require_editor, require_verifier
from ..services.audit import log
from ..services.checks import run_quality_checks

router = APIRouter(prefix="/tasks", tags=["verification"])


def _comment_out(c: models.Comment) -> schemas.CommentOut:
    return schemas.CommentOut(
        id=c.id, task_id=c.task_id, segment_id=c.segment_id,
        author_id=c.author_id, author_name=c.author_name, text=c.text,
        category=c.category, status=c.status, created_at=c.created_at,
    )


@router.post("/{task_id}/comments", response_model=schemas.CommentOut)
def add_comment(
    task_id: int,
    data: schemas.CommentIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_editor),
):
    task = db.get(models.Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    comment = models.Comment(
        task_id=task_id,
        segment_id=data.segment_id,
        author_id=user.id,
        author_name=user.full_name,
        text=data.text,
        category=data.category,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    log(db, user, "comment", comment.id, "create", new_value=data.text[:200])
    return _comment_out(comment)


@router.get("/{task_id}/comments", response_model=list[schemas.CommentOut])
def list_comments(task_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_any)):
    comments = db.query(models.Comment).filter(models.Comment.task_id == task_id).order_by(models.Comment.id.desc()).all()
    return [_comment_out(c) for c in comments]


@router.put("/comments/{comment_id}/resolve")
def resolve_comment(comment_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_editor)):
    comment = db.get(models.Comment, comment_id)
    if comment is None:
        raise HTTPException(status_code=404, detail="Замечание не найдено")
    comment.status = "resolved"
    db.commit()
    log(db, user, "comment", comment_id, "resolve")
    return {"ok": True}


@router.post("/{task_id}/return")
def return_task(
    task_id: int,
    data: schemas.VerifyIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_verifier),
):
    """Возврат задачи на доработку с замечаниями."""
    task = db.get(models.Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    if task.status not in ("on_review", "fixed"):
        raise HTTPException(status_code=400, detail="Задача не находится на проверке")

    task.status = "rework"
    db.add(models.VerificationResult(
        task_id=task_id, verifier_id=user.id, decision="returned",
        score=data.score, comment=data.comment,
    ))
    if data.comment:
        db.add(models.Comment(
            task_id=task_id, author_id=user.id, author_name=user.full_name,
            text=data.comment, category="general",
        ))
    db.commit()
    log(db, user, "task", task_id, "return", new_value=data.comment[:200])
    return {"ok": True, "status": task.status}


@router.post("/{task_id}/accept")
def accept_task(
    task_id: int,
    data: schemas.VerifyIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_verifier),
):
    """Приёмка задачи."""
    task = db.get(models.Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    if task.status not in ("on_review", "fixed"):
        raise HTTPException(status_code=400, detail="Задача не находится на проверке")

    # финальные автопроверки
    checks = run_quality_checks(db, task)
    errors = [c for c in checks if c.result == "error"]
    if errors:
        raise HTTPException(
            status_code=400,
            detail=f"Найдены критические ошибки ({len(errors)}). Верните задачу на доработку.",
        )

    task.status = "accepted"
    db.add(models.VerificationResult(
        task_id=task_id, verifier_id=user.id, decision="accepted",
        score=data.score, comment=data.comment,
    ))
    db.commit()
    log(db, user, "task", task_id, "accept", new_value=f"score={data.score}")
    return {"ok": True, "status": task.status}


@router.get("/{task_id}/verification-results")
def get_verification_results(task_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_any)):
    results = db.query(models.VerificationResult).filter(models.VerificationResult.task_id == task_id).order_by(models.VerificationResult.id.desc()).all()
    return [
        {
            "id": r.id,
            "verifier_id": r.verifier_id,
            "decision": r.decision,
            "score": r.score,
            "comment": r.comment,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in results
    ]
