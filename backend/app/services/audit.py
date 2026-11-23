"""Журналирование действий пользователей (AuditLog)."""
from sqlalchemy.orm import Session

from .. import models


def log(
    db: Session,
    user: models.User | None,
    entity_type: str,
    entity_id: int | None,
    action: str,
    old_value: str = "",
    new_value: str = "",
):
    entry = models.AuditLog(
        user_id=user.id if user else None,
        user_name=user.full_name if user else "system",
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        old_value=str(old_value)[:2000],
        new_value=str(new_value)[:2000],
    )
    db.add(entry)
    db.commit()
