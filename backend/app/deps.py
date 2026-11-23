"""Зависимости FastAPI: текущий пользователь, права доступа."""
from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from . import models
from .config import ROLE_ADMIN, ROLE_ANNOTATOR, ROLE_CUSTOMER, ROLE_ML_ENGINEER, ROLE_SUPERVISOR, ROLE_VERIFIER
from .database import get_db
from .security import decode_token

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> models.User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Требуется авторизация")
    try:
        payload = decode_token(credentials.credentials)
        user_id = int(payload.get("sub", "0"))
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Недействительный токен")
    user = db.get(models.User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Пользователь не найден")
    if user.status == "blocked":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Пользователь заблокирован")
    return user


def require_roles(*roles: str):
    def checker(user: models.User = Depends(get_current_user)) -> models.User:
        if user.role.name not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав")
        return user
    return checker


require_admin = require_roles(ROLE_ADMIN)
require_supervisor = require_roles(ROLE_ADMIN, ROLE_SUPERVISOR)
require_annotator = require_roles(ROLE_ADMIN, ROLE_SUPERVISOR, ROLE_ANNOTATOR)
require_verifier = require_roles(ROLE_ADMIN, ROLE_SUPERVISOR, ROLE_VERIFIER)
require_any = require_roles(ROLE_ADMIN, ROLE_SUPERVISOR, ROLE_ANNOTATOR, ROLE_VERIFIER, ROLE_ML_ENGINEER, ROLE_CUSTOMER)
# разметчик или верификатор — для комментариев и правок в рабочем процессе
require_editor = require_roles(ROLE_ADMIN, ROLE_SUPERVISOR, ROLE_ANNOTATOR, ROLE_VERIFIER)


def token_or_header_user(
    token: str | None = Query(None, description="JWT для <audio>/<video> src и прямых ссылок, где заголовок недоступен"),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> models.User:
    """Авторизация по заголовку Authorization либо по query-параметру token."""
    raw = credentials.credentials if credentials else token
    if not raw:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Требуется авторизация")
    try:
        payload = decode_token(raw)
        user = db.get(models.User, int(payload.get("sub", "0")))
    except Exception:
        user = None
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Недействительный токен")
    if user.status == "blocked":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Пользователь заблокирован")
    return user
