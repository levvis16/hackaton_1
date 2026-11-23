"""Tasks API."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..config import TASK_STATUS_LABELS
from ..database import get_db
from ..deps import require_any, require_annotator, require_supervisor
from ..services.audit import log
from ..services.checks import run_quality_checks

router = APIRouter(prefix="/tasks", tags=["tasks"])

CHECKLIST_DEFAULT = [
    ("listened_full", "Запись прослушана до конца"),
    ("segments_checked", "Все сегменты проверены"),
    ("boundaries_fixed", "Границы сегментов исправлены"),
    ("truncated_checked", "Обрезанные слова проверены"),
    ("missed_speech_added", "Пропущенная речь добавлена"),
    ("bad_removed", "Некорректная разметка удалена"),
    ("crosstalks_handled", "Кросстолки обработаны"),
    ("short_replies_added", "Значимые короткие реплики добавлены"),
    ("terms_checked", "Термины проверены"),
    ("disputed_terms_fixed", "Спорные термины зафиксированы"),
    ("no_unsaved", "Несохранённых изменений нет"),
]


def _task_out(db: Session, t: models.Task) -> schemas.TaskOut:
    project = db.get(models.Project, t.project_id)
    assignee = db.get(models.User, t.assignee_id) if t.assignee_id else None
    verifier = db.get(models.User, t.verifier_id) if t.verifier_id else None
    media = db.get(models.MediaFile, t.media_file_id) if t.media_file_id else None
    return schemas.TaskOut(
        id=t.id,
        project_id=t.project_id,
        media_file_id=t.media_file_id,
        assignee_id=t.assignee_id,
        verifier_id=t.verifier_id,
        status=t.status,
        priority=t.priority,
        deadline=t.deadline,
        project_name=project.name if project else "",
        assignee_name=assignee.full_name if assignee else "",
        verifier_name=verifier.full_name if verifier else "",
        media_name=media.original_name if media else "",
        duration=media.duration if media else 0.0,
        segment_count=len(t.segments),
        updated_at=t.updated_at,
    )


@router.get("", response_model=list[schemas.TaskOut])
def list_tasks(
    project_id: int | None = None,
    status: str | None = None,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_any),
):
    q = db.query(models.Task)
    if project_id:
        q = q.filter(models.Task.project_id == project_id)
    if status:
        q = q.filter(models.Task.status == status)

    # разметчик видит только свои задачи, верификатор — назначенные на проверку
    if user.role.name == "annotator":
        q = q.filter(models.Task.assignee_id == user.id)
    elif user.role.name == "verifier":
        q = q.filter(models.Task.verifier_id == user.id)

    tasks = q.order_by(models.Task.id.desc()).all()
    return [_task_out(db, t) for t in tasks]


@router.post("", response_model=schemas.TaskOut)
def create_task(
    data: schemas.TaskIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_supervisor),
):
    task = models.Task(
        project_id=data.project_id,
        media_file_id=data.media_file_id,
        assignee_id=data.assignee_id,
        verifier_id=data.verifier_id,
        priority=data.priority,
        deadline=data.deadline,
        status="assigned" if data.assignee_id else "new",
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    # создаём чек-лист по умолчанию
    for key, label in CHECKLIST_DEFAULT:
        db.add(models.ChecklistItem(task_id=task.id, key=key, label=label))
    db.commit()

    log(db, user, "task", task.id, "create", new_value=f"project={task.project_id}")
    return _task_out(db, task)


@router.get("/{task_id}", response_model=schemas.TaskOut)
def get_task(task_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_any)):
    task = db.get(models.Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    return _task_out(db, task)


@router.put("/{task_id}/status", response_model=schemas.TaskOut)
def change_status(
    task_id: int,
    data: schemas.TaskStatusIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_supervisor),
):
    task = db.get(models.Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    old = task.status
    task.status = data.status
    db.commit()
    log(db, user, "task", task.id, "change_status",
        old_value=TASK_STATUS_LABELS.get(old, old), new_value=TASK_STATUS_LABELS.get(data.status, data.status))
    return _task_out(db, task)


@router.post("/{task_id}/assign", response_model=schemas.TaskOut)
def assign_task(
    task_id: int,
    data: schemas.AssignIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_supervisor),
):
    task = db.get(models.Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    old = f"assignee={task.assignee_id}, verifier={task.verifier_id}"
    task.assignee_id = data.assignee_id
    task.verifier_id = data.verifier_id
    if task.status in ("new", "assigned"):
        task.status = "assigned"
    db.add(models.TaskAssignmentHistory(
        task_id=task.id, assignee_id=data.assignee_id, verifier_id=data.verifier_id, action="assign"
    ))
    db.commit()
    log(db, user, "task", task.id, "assign", old_value=old,
        new_value=f"assignee={data.assignee_id}, verifier={data.verifier_id}")
    return _task_out(db, task)


@router.post("/{task_id}/start", response_model=schemas.TaskOut)
def start_task(task_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_annotator)):
    task = db.get(models.Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    if task.assignee_id and task.assignee_id != user.id and user.role.name == "annotator":
        raise HTTPException(status_code=403, detail="Задача назначена другому разметчику")
    if task.status in ("assigned", "new", "rework", "fixed"):
        task.status = "in_progress"
        db.commit()
        log(db, user, "task", task.id, "start")
    return _task_out(db, task)


@router.post("/{task_id}/submit", response_model=schemas.TaskOut)
def submit_task(task_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_annotator)):
    """Отправка на проверку: запускает автопроверки и проверяет чек-лист."""
    task = db.get(models.Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Задача не найдена")

    # автопроверки
    checks = run_quality_checks(db, task)
    errors = [c for c in checks if c.result == "error"]
    if errors:
        raise HTTPException(
            status_code=400,
            detail=f"Найдены критические ошибки ({len(errors)}). Исправьте их перед отправкой.",
        )

    # чек-лист
    items = db.query(models.ChecklistItem).filter(models.ChecklistItem.task_id == task.id).all()
    unchecked = [i for i in items if not i.checked]
    if unchecked:
        raise HTTPException(
            status_code=400,
            detail=f"Не отмечены пункты чек-листа: {', '.join(i.label for i in unchecked)}",
        )

    task.status = "on_review"
    db.commit()
    log(db, user, "task", task.id, "submit", new_value="on_review")
    return _task_out(db, task)


@router.get("/{task_id}/checklist", response_model=list[schemas.ChecklistIn])
def get_checklist(task_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_any)):
    items = db.query(models.ChecklistItem).filter(models.ChecklistItem.task_id == task_id).all()
    return [schemas.ChecklistIn(key=i.key, label=i.label, checked=i.checked) for i in items]


@router.get("/{task_id}/quality-checks", response_model=list[schemas.QualityCheckOut])
def get_quality_checks(task_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_any)):
    """Возвращает результат автоматических проверок задачи (пересчитывает на лету)."""
    task = db.get(models.Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    return run_quality_checks(db, task)


@router.put("/{task_id}/checklist", response_model=list[schemas.ChecklistIn])
def update_checklist(
    task_id: int,
    data: list[schemas.ChecklistIn],
    db: Session = Depends(get_db),
    user: models.User = Depends(require_annotator),
):
    for item in data:
        row = db.query(models.ChecklistItem).filter(
            models.ChecklistItem.task_id == task_id,
            models.ChecklistItem.key == item.key,
        ).first()
        if row:
            row.checked = item.checked
    db.commit()
    items = db.query(models.ChecklistItem).filter(models.ChecklistItem.task_id == task_id).all()
    return [schemas.ChecklistIn(key=i.key, label=i.label, checked=i.checked) for i in items]
