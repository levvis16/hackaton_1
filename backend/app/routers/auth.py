"""Auth API: регистрация, вход, выход, текущий пользователь."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import get_current_user
from ..security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=schemas.TokenOut)
def register(data: schemas.RegisterIn, db: Session = Depends(get_db)):
    if db.query(models.User).filter(models.User.email == data.email.lower()).first():
        raise HTTPException(status_code=400, detail="Пользователь с таким email уже существует")

    role = db.query(models.Role).filter(models.Role.name == data.role).first()
    if role is None:
        role = db.query(models.Role).filter(models.Role.name == "annotator").first()

    user = models.User(
        full_name=data.full_name,
        email=data.email.lower(),
        password_hash=hash_password(data.password),
        role_id=role.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id, role.name)
    return schemas.TokenOut(access_token=token, user=schemas.UserOut.model_validate(user))


@router.post("/login", response_model=schemas.TokenOut)
def login(data: schemas.LoginIn, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == data.email.lower()).first()
    if user is None or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Неверный email или пароль")
    if user.status == "blocked":
        raise HTTPException(status_code=403, detail="Пользователь заблокирован")

    token = create_access_token(user.id, user.role.name)
    return schemas.TokenOut(access_token=token, user=schemas.UserOut.model_validate(user))


@router.post("/logout")
def logout():
    # JWT stateless: клиент просто удаляет токен
    return {"ok": True}


@router.post("/refresh", response_model=schemas.TokenOut)
def refresh(user: models.User = Depends(get_current_user)):
    token = create_access_token(user.id, user.role.name)
    return schemas.TokenOut(access_token=token, user=schemas.UserOut.model_validate(user))


@router.get("/me", response_model=schemas.UserOut)
def me(user: models.User = Depends(get_current_user)):
    return user
