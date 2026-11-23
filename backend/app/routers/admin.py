"""Admin API: пользователи, роли, аудит."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import require_admin, require_any, require_supervisor
from ..security import hash_password
from ..services.audit import log

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users", response_model=list[schemas.UserOut])
def list_users(db: Session = Depends(get_db), user: models.User = Depends(require_admin)):
    return db.query(models.User).order_by(models.User.id).all()


@router.get("/users/assignable", response_model=list[schemas.UserOut])
def list_assignable(db: Session = Depends(get_db), user: models.User = Depends(require_supervisor)):
    """Исполнители (разметчики и верификаторы) для назначения задач."""
    role_ids = [
        r.id for r in db.query(models.Role).filter(models.Role.name.in_(["annotator", "verifier"])).all()
    ]
    if not role_ids:
        return []
    return (
        db.query(models.User)
        .filter(models.User.role_id.in_(role_ids), models.User.status == "active")
        .order_by(models.User.id)
        .all()
    )


@router.post("/users", response_model=schemas.UserOut)
def create_user(data: schemas.RegisterIn, db: Session = Depends(get_db), user: models.User = Depends(require_admin)):
    if db.query(models.User).filter(models.User.email == data.email.lower()).first():
        raise HTTPException(status_code=400, detail="Пользователь с таким email уже существует")
    role = db.query(models.Role).filter(models.Role.name == data.role).first()
    if role is None:
        raise HTTPException(status_code=400, detail="Роль не найдена")
    new_user = models.User(
        full_name=data.full_name,
        email=data.email.lower(),
        password_hash=hash_password(data.password),
        role_id=role.id,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    log(db, user, "user", new_user.id, "create", new_value=new_user.email)
    return new_user


@router.put("/users/{user_id}", response_model=schemas.UserOut)
def update_user(
    user_id: int,
    data: schemas.UserUpdate,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_admin),
):
    target = db.get(models.User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if data.full_name is not None:
        target.full_name = data.full_name
    if data.role_id is not None:
        target.role_id = data.role_id
    if data.status is not None:
        target.status = data.status
    if data.password:
        target.password_hash = hash_password(data.password)
    db.commit()
    db.refresh(target)
    log(db, user, "user", user_id, "update", new_value=f"status={target.status}")
    return target


@router.get("/roles", response_model=list[schemas.RoleOut])
def list_roles(db: Session = Depends(get_db), user: models.User = Depends(require_any)):
    return db.query(models.Role).all()


@router.get("/audit")
def list_audit(
    limit: int = 200,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_admin),
):
    entries = db.query(models.AuditLog).order_by(models.AuditLog.id.desc()).limit(limit).all()
    return [
        {
            "id": e.id,
            "user_name": e.user_name,
            "entity_type": e.entity_type,
            "entity_id": e.entity_id,
            "action": e.action,
            "old_value": e.old_value,
            "new_value": e.new_value,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in entries
    ]


@router.get("/assignment-history")
def assignment_history(db: Session = Depends(get_db), user: models.User = Depends(require_supervisor)):
    entries = db.query(models.TaskAssignmentHistory).order_by(models.TaskAssignmentHistory.id.desc()).limit(200).all()
    return [
        {
            "id": e.id,
            "task_id": e.task_id,
            "assignee_id": e.assignee_id,
            "verifier_id": e.verifier_id,
            "action": e.action,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in entries
    ]
