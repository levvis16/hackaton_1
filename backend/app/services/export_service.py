"""Экспорт разметки в JSON (формат, совместимый с Gecko) и отчёты."""
import json
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from .. import models
from ..config import EXPORT_DIR


def build_gecko_json(task: models.Task) -> dict:
    """Формирует итоговый JSON в формате, совместимом с Gecko."""
    segments = sorted(task.segments, key=lambda s: s.start_time)
    speakers = {s.id: s.original_name or s.display_name for s in task.speakers}

    items = []
    for seg in segments:
        items.append({
            "id": seg.id,
            "start": round(seg.start_time, 3),
            "end": round(seg.end_time, 3),
            "text": seg.text,
            "speaker": seg.speaker_name or speakers.get(seg.speaker_id, ""),
            "confidence": round(seg.confidence or 1.0, 3),
            "is_crosstalk": seg.is_crosstalk,
            "status": seg.status,
        })

    return {
        "format": "gecko",
        "version": "1.0",
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "task_id": task.id,
        "project_id": task.project_id,
        "media_file_id": task.media_file_id,
        "segments": items,
        "meta": {
            "duration": task.media_file.duration if task.media_file else 0.0,
            "segment_count": len(items),
        },
    }


def build_ml_json(task: models.Task) -> dict:
    """Версия для ML/ASR-пайплайна: только текст и границы."""
    segments = sorted(task.segments, key=lambda s: s.start_time)
    return {
        "task_id": task.id,
        "segments": [
            {
                "start": round(s.start_time, 3),
                "end": round(s.end_time, 3),
                "text": s.text,
            }
            for s in segments
        ],
    }


def build_report(task: models.Task, db: Session) -> dict:
    """Отчёт по качеству задачи."""
    segments = task.segments
    checks = task.quality_checks
    comments = task.comments
    errors = [c for c in checks if c.result == "error"]
    warnings = [c for c in checks if c.result == "warning"]

    total_dur = sum(s.end_time - s.start_time for s in segments)
    return {
        "task_id": task.id,
        "project_id": task.project_id,
        "status": task.status,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "segments": {
            "total": len(segments),
            "with_text": sum(1 for s in segments if s.text.strip()),
            "without_text": sum(1 for s in segments if not s.text.strip()),
            "crosstalks": sum(1 for s in segments if s.is_crosstalk),
            "total_duration_seconds": round(total_dur, 2),
        },
        "quality_checks": {
            "total": len(checks),
            "errors": len(errors),
            "warnings": len(warnings),
            "items": [
                {"type": c.check_type, "result": c.result, "message": c.message}
                for c in checks
            ],
        },
        "comments": {
            "total": len(comments),
            "open": sum(1 for c in comments if c.status == "open"),
            "resolved": sum(1 for c in comments if c.status == "resolved"),
        },
    }


def save_export(task: models.Task, db: Session, format_name: str, data: dict) -> models.ExportFile:
    """Сохраняет экспорт в файл и запись в БД."""
    filename = f"task_{task.id}_{format_name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    path = EXPORT_DIR / filename
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    export = models.ExportFile(task_id=task.id, format=format_name, path=str(path))
    db.add(export)
    db.commit()
    db.refresh(export)
    return export
