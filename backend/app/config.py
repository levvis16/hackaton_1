"""Конфигурация приложения."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent  # backend/
PROJECT_ROOT = BASE_DIR.parent  # корень проекта

DATA_DIR = Path(os.getenv("GECKO_DATA_DIR", BASE_DIR / "data"))
UPLOAD_DIR = DATA_DIR / "uploads"
EXPORT_DIR = DATA_DIR / "exports"
DB_PATH = DATA_DIR / "gecko.db"

for d in (DATA_DIR, UPLOAD_DIR, EXPORT_DIR):
    d.mkdir(parents=True, exist_ok=True)

DATABASE_URL = f"sqlite:///{DB_PATH.as_posix()}"

SECRET_KEY = os.getenv("GECKO_SECRET_KEY", "gecko-next-hackathon-secret-key-2026")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 12  # 12 часов

AUTOSAVE_INTERVAL_SECONDS = 5  # автосохранение не реже 5 секунд

# Роли
ROLE_ADMIN = "admin"
ROLE_SUPERVISOR = "supervisor"
ROLE_ANNOTATOR = "annotator"      # разметчик
ROLE_VERIFIER = "verifier"        # верификатор
ROLE_ML_ENGINEER = "ml_engineer"
ROLE_CUSTOMER = "customer"

# Статусы задач
TASK_STATUSES = [
    "new",            # Новая
    "assigned",       # Назначена
    "in_progress",    # В работе
    "on_review",      # На проверке
    "rework",         # На доработке
    "fixed",          # Исправлена
    "accepted",       # Принята
    "exported",       # Выгружена
]

TASK_STATUS_LABELS = {
    "new": "Новая",
    "assigned": "Назначена",
    "in_progress": "В работе",
    "on_review": "На проверке",
    "rework": "На доработке",
    "fixed": "Исправлена",
    "accepted": "Принята",
    "exported": "Выгружена",
}

# Статусы терминов
TERM_STATUSES = ["new", "on_review", "approved", "rejected"]
TERM_STATUS_LABELS = {
    "new": "Новый",
    "on_review": "На проверке",
    "approved": "Подтверждён",
    "rejected": "Отклонён",
}

# Статусы сегментов
SEGMENT_STATUSES = ["pending", "checked", "disputed", "crosstalk"]
