"""Создание демо-данных: роли, пользователи, проект, задача, аудио, сегменты, термины."""
import json
import math
import struct
import wave
from pathlib import Path

import numpy as np

from . import models
from .config import UPLOAD_DIR
from .database import SessionLocal
from .security import hash_password

ROLES = [
    ("admin", "Администратор"),
    ("supervisor", "Супервайзер"),
    ("annotator", "Разметчик"),
    ("verifier", "Верификатор"),
    ("ml_engineer", "ML-инженер"),
    ("customer", "Заказчик"),
]

USERS = [
    ("Админ", "admin@gecko.local", "admin123", "admin"),
    ("Супервайзер", "supervisor@gecko.local", "super123", "supervisor"),
    ("Иван Разметчик", "annotator@gecko.local", "annot123", "annotator"),
    ("Мария Верификатор", "verifier@gecko.local", "verif123", "verifier"),
    ("ML Инженер", "ml@gecko.local", "ml12345", "ml_engineer"),
    ("Заказчик", "customer@gecko.local", "cust123", "customer"),
]

# Демо-транскрипция: (start, end, text, speaker, confidence)
DEMO_SEGMENTS = [
    (0.5, 3.2, "Добрый день, коллеги. Начинаем совещание по проекту YADRO.", "Спикер 1", 0.92),
    (3.6, 6.8, "Сегодня обсудим интеграцию системы UNIFIED с нашим бэкендом.", "Спикер 1", 0.88),
    (7.2, 9.5, "Да, и ещё нужно проверить конфигурацию в формате JSON.", "Спикер 2", 0.75),
    (10.0, 13.4, "Коллеги, напоминаю, что дедлайн по задаче — пятница.", "Спикер 1", 0.9),
    (14.0, 16.2, "Угу, понял. Тогда завтра соберёмся и посмотрим.", "Спикер 2", 0.6),
    (17.0, 20.5, "Отлично. Также прошу проверить термины TATLIN и VEGMAN в документации.", "Спикер 1", 0.85),
    (21.0, 24.0, "Хорошо, я подготовлю отчёт и выгружу данные в формате CSV.", "Спикер 2", 0.8),
    (25.0, 28.5, "Спасибо всем за внимание, совещание окончено.", "Спикер 1", 0.93),
]

DEMO_TERMS = [
    ("YADRO", "abbreviation", "Название компании, пишется латиницей в верхнем регистре"),
    ("TATLIN", "term", "Название продукта"),
    ("VEGMAN", "term", "Название продукта"),
    ("UNIFIED", "term", "Название продукта"),
    ("BACKUP", "term", "Название продукта"),
    ("FLEX", "term", "Название продукта"),
    ("ARCHIVE", "term", "Название продукта"),
    ("CI/CD", "abbreviation", "Термин со слешем"),
    ("API'шный", "disputed", "Русифицированный англицизм с апострофом"),
    ("IP'шник", "disputed", "Русифицированный англицизм с апострофом"),
    ("SSD'шник", "disputed", "Русифицированный англицизм с апострофом"),
]


def generate_demo_audio(path: Path, duration: float = 30.0, sr: int = 16000):
    """Генерирует речеподобный WAV: модулированный шум с паузами."""
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    # огибающая: речевые участки (по сегментам) с шумом, паузы — тишина
    signal = np.zeros_like(t)
    for start, end, *_ in DEMO_SEGMENTS:
        mask = (t >= start) & (t < end)
        local = t[mask] - start
        # модуляция "слогами" ~4 Гц
        envelope = 0.5 + 0.5 * np.sin(2 * math.pi * 4.0 * local)
        envelope = np.clip(envelope, 0.1, 1.0)
        voice = np.sin(2 * math.pi * 180 * local) * 0.4 + np.sin(2 * math.pi * 240 * local) * 0.3
        noise = np.random.default_rng(42).normal(0, 0.15, size=local.shape)
        signal[mask] = (voice + noise) * envelope * 0.6

    # мягкие края
    fade = int(sr * 0.05)
    if fade > 0:
        ramp = np.linspace(0, 1, fade)
        signal[:fade] *= ramp
        signal[-fade:] *= ramp[::-1]

    pcm = (np.clip(signal, -1, 1) * 32767).astype(np.int16)

    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(pcm.tobytes())


def seed_demo_data():
    db = SessionLocal()
    try:
        # Роли
        roles = {}
        for name, label in ROLES:
            role = db.query(models.Role).filter(models.Role.name == name).first()
            if role is None:
                role = models.Role(name=name, label=label)
                db.add(role)
                db.flush()
            roles[name] = role.id

        # Пользователи
        users = {}
        for full_name, email, password, role_name in USERS:
            user = db.query(models.User).filter(models.User.email == email).first()
            if user is None:
                user = models.User(
                    full_name=full_name, email=email,
                    password_hash=hash_password(password),
                    role_id=roles[role_name],
                )
                db.add(user)
                db.flush()
            users[role_name] = user.id

        # Проект
        project = db.query(models.Project).filter(models.Project.name == "Демо-проект: разметка совещаний").first()
        if project is None:
            project = models.Project(
                name="Демо-проект: разметка совещаний",
                description="Демонстрационный проект для хакатона Gecko Next. Разметка аудиозаписей совещаний с техническими терминами.",
                customer="YADRO",
                deadline="2026-12-31",
            )
            db.add(project)
            db.flush()

        # Медиафайл
        media = db.query(models.MediaFile).filter(models.MediaFile.original_name == "demo_meeting.wav").first()
        if media is None:
            audio_path = UPLOAD_DIR / "demo_meeting.wav"
            if not audio_path.exists():
                generate_demo_audio(audio_path)
            media = models.MediaFile(
                project_id=project.id,
                audio_path=str(audio_path),
                original_name="demo_meeting.wav",
                duration=30.0,
                format="wav",
            )
            db.add(media)
            db.flush()

        # Задача
        task = db.query(models.Task).filter(models.Task.project_id == project.id).first()
        if task is None:
            task = models.Task(
                project_id=project.id,
                media_file_id=media.id,
                assignee_id=users["annotator"],
                verifier_id=users["verifier"],
                status="assigned",
                priority="high",
                deadline="2026-12-20",
            )
            db.add(task)
            db.flush()

            # сегменты
            for i, (start, end, text, speaker, conf) in enumerate(DEMO_SEGMENTS):
                db.add(models.Segment(
                    task_id=task.id, start_time=start, end_time=end,
                    text=text, speaker_name=speaker, confidence=conf,
                    order_index=i, status="pending",
                ))
                sp = db.query(models.Speaker).filter(
                    models.Speaker.task_id == task.id,
                    models.Speaker.original_name == speaker,
                ).first()
                if sp is None:
                    db.add(models.Speaker(task_id=task.id, original_name=speaker, display_name=speaker))

            # чек-лист
            from .routers.tasks import CHECKLIST_DEFAULT
            for key, label in CHECKLIST_DEFAULT:
                db.add(models.ChecklistItem(task_id=task.id, key=key, label=label))

            # предразметка
            source = {
                "format": "gecko",
                "version": "1.0",
                "segments": [
                    {"id": i + 1, "start": s, "end": e, "text": t, "speaker": spk, "confidence": c}
                    for i, (s, e, t, spk, c) in enumerate(DEMO_SEGMENTS)
                ],
            }
            raw = json.dumps(source, ensure_ascii=False)
            task.source_json = raw
            db.add(models.Transcript(task_id=task.id, source_json=raw, current_json=raw, version=1))

        # Термины
        for value, term_type, comment in DEMO_TERMS:
            existing = db.query(models.Term).filter(
                models.Term.project_id == project.id,
                models.Term.normalized_value == value.lower(),
            ).first()
            if existing is None:
                db.add(models.Term(
                    project_id=project.id, value=value, normalized_value=value.lower(),
                    type=term_type, status="new", comment=comment,
                ))

        db.commit()
    finally:
        db.close()
