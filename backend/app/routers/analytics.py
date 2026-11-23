"""Analytics API: метрики по проектам и исполнителям."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import require_any, require_supervisor

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/project/{project_id}", response_model=schemas.AnalyticsOut)
def project_analytics(project_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_any)):
    tasks = db.query(models.Task).filter(models.Task.project_id == project_id).all()
    task_ids = [t.id for t in tasks]

    total_duration = 0.0
    total_segments = 0
    total_edits = 0
    total_comments = 0
    by_status = {}
    by_user = {}

    for t in tasks:
        by_status[t.status] = by_status.get(t.status, 0) + 1
        if t.media_file:
            total_duration += t.media_file.duration or 0.0
        total_segments += len(t.segments)
        if t.assignee_id:
            u = by_user.setdefault(t.assignee_id, {"tasks": 0, "accepted": 0, "returned": 0, "edits": 0, "duration": 0.0})
            u["tasks"] += 1
            u["duration"] += t.media_file.duration if t.media_file else 0.0
            if t.status in ("accepted", "exported"):
                u["accepted"] += 1
            if t.status == "rework":
                u["returned"] += 1

    if task_ids:
        total_edits = db.query(models.SegmentEdit).filter(
            models.SegmentEdit.segment_id.in_(
                db.query(models.Segment.id).filter(models.Segment.task_id.in_(task_ids))
            )
        ).count()
        total_comments = db.query(models.Comment).filter(models.Comment.task_id.in_(task_ids)).count()

    terms = db.query(models.Term).filter(models.Term.project_id == project_id).all()
    terms_stats = {
        "total": len(terms),
        "new": sum(1 for t in terms if t.status == "new"),
        "on_review": sum(1 for t in terms if t.status == "on_review"),
        "approved": sum(1 for t in terms if t.status == "approved"),
        "rejected": sum(1 for t in terms if t.status == "rejected"),
    }

    returned = sum(1 for t in tasks if t.status == "rework")
    reviewed = sum(1 for t in tasks if t.status in ("accepted", "exported", "rework"))
    return_rate = (returned / reviewed * 100) if reviewed else 0.0

    progress = (sum(1 for t in tasks if t.status in ("accepted", "exported")) / len(tasks) * 100) if tasks else 0.0

    return schemas.AnalyticsOut(
        project_id=project_id,
        total_tasks=len(tasks),
        processed_tasks=sum(1 for t in tasks if t.status not in ("new", "assigned")),
        accepted_tasks=sum(1 for t in tasks if t.status in ("accepted", "exported")),
        rework_tasks=returned,
        total_duration=round(total_duration, 2),
        total_segments=total_segments,
        total_edits=total_edits,
        total_comments=total_comments,
        return_rate=round(return_rate, 1),
        terms=terms_stats,
        by_status=by_status,
        by_user=[
            {
                "user_id": uid,
                "tasks": v["tasks"],
                "accepted": v["accepted"],
                "returned": v["returned"],
                "edits": v["edits"],
                "duration": round(v["duration"], 2),
            }
            for uid, v in by_user.items()
        ],
        progress=round(progress, 1),
    )


@router.get("/users", response_model=list[schemas.UserAnalyticsOut])
def users_analytics(db: Session = Depends(get_db), user: models.User = Depends(require_supervisor)):
    users = db.query(models.User).all()
    result = []
    for u in users:
        tasks = db.query(models.Task).filter(models.Task.assignee_id == u.id).all()
        task_ids = [t.id for t in tasks]
        edits = 0
        if task_ids:
            edits = db.query(models.SegmentEdit).filter(
                models.SegmentEdit.segment_id.in_(
                    db.query(models.Segment.id).filter(models.Segment.task_id.in_(task_ids))
                )
            ).count()
        accepted = sum(1 for t in tasks if t.status in ("accepted", "exported"))
        returned = sum(1 for t in tasks if t.status == "rework")
        duration = sum(t.media_file.duration or 0.0 for t in tasks if t.media_file)
        quality = (accepted / len(tasks) * 100) if tasks else 0.0
        result.append(schemas.UserAnalyticsOut(
            user_id=u.id, full_name=u.full_name, role=u.role.name if u.role else "",
            tasks_total=len(tasks), tasks_accepted=accepted, tasks_returned=returned,
            edits=edits, duration_seconds=round(duration, 2), quality_score=round(quality, 1),
        ))
    return result


@router.get("/quality")
def quality_metrics(db: Session = Depends(get_db), user: models.User = Depends(require_supervisor)):
    checks = db.query(models.QualityCheck).all()
    by_type = {}
    for c in checks:
        by_type.setdefault(c.check_type, {"ok": 0, "warning": 0, "error": 0})
        by_type[c.check_type][c.result] = by_type[c.check_type].get(c.result, 0) + 1
    return {
        "total_checks": len(checks),
        "errors": sum(1 for c in checks if c.result == "error"),
        "warnings": sum(1 for c in checks if c.result == "warning"),
        "by_type": by_type,
    }


@router.get("/terms")
def terms_analytics(db: Session = Depends(get_db), user: models.User = Depends(require_any)):
    terms = db.query(models.Term).all()
    return {
        "total": len(terms),
        "new": sum(1 for t in terms if t.status == "new"),
        "on_review": sum(1 for t in terms if t.status == "on_review"),
        "approved": sum(1 for t in terms if t.status == "approved"),
        "rejected": sum(1 for t in terms if t.status == "rejected"),
        "by_type": {
            "term": sum(1 for t in terms if t.type == "term"),
            "abbreviation": sum(1 for t in terms if t.type == "abbreviation"),
            "disputed": sum(1 for t in terms if t.type == "disputed"),
            "unknown": sum(1 for t in terms if t.type == "unknown"),
        },
    }
