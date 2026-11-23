"""Автоматические проверки качества разметки."""
from typing import List

from sqlalchemy.orm import Session

from .. import models

MIN_SEGMENT_DURATION = 0.3
MAX_SEGMENT_DURATION = 30.0
MAX_PAUSE_DURATION = 5.0


def run_quality_checks(db: Session, task: models.Task) -> List[models.QualityCheck]:
    """Запускает все автоматические проверки задачи и сохраняет результаты."""
    # очищаем старые проверки
    db.query(models.QualityCheck).filter(models.QualityCheck.task_id == task.id).delete()

    checks: List[models.QualityCheck] = []
    segments = sorted(task.segments, key=lambda s: s.start_time)

    def add(check_type: str, result: str, message: str, severity: str = "info", segment_id=None):
        checks.append(models.QualityCheck(
            task_id=task.id, check_type=check_type, result=result,
            message=message, severity=severity, segment_id=segment_id,
        ))

    # 1. Пустые сегменты / сегменты без текста
    for seg in segments:
        if seg.end_time - seg.start_time <= 0.01:
            add("empty_segment", "error", f"Сегмент #{seg.id}: нулевая длительность", "error", seg.id)
        if not seg.text.strip():
            add("no_text", "warning", f"Сегмент #{seg.id} ({fmt(seg.start_time)}–{fmt(seg.end_time)}): нет текста", "warning", seg.id)

    # 2. Пересекающиеся сегменты
    for i in range(1, len(segments)):
        prev, cur = segments[i - 1], segments[i]
        if cur.start_time < prev.end_time - 0.01:
            add("overlap", "error",
                f"Пересечение сегментов #{prev.id} и #{cur.id}",
                "error", cur.id)

    # 3. Слишком короткие / длинные сегменты
    for seg in segments:
        dur = seg.end_time - seg.start_time
        if 0 < dur < MIN_SEGMENT_DURATION:
            add("too_short", "warning",
                f"Сегмент #{seg.id}: слишком короткий ({dur:.2f} с)", "warning", seg.id)
        if dur > MAX_SEGMENT_DURATION:
            add("too_long", "warning",
                f"Сегмент #{seg.id}: слишком длинный ({dur:.2f} с)", "warning", seg.id)

    # 4. Подозрительно длинная пауза между сегментами
    for i in range(1, len(segments)):
        prev, cur = segments[i - 1], segments[i]
        gap = cur.start_time - prev.end_time
        if gap > MAX_PAUSE_DURATION:
            add("long_pause", "warning",
                f"Длинная пауза {gap:.1f} с между сегментами #{prev.id} и #{cur.id} — возможна пропущенная речь",
                "warning", cur.id)

    # 5. Нарушенный порядок времени
    for i in range(1, len(segments)):
        prev, cur = segments[i - 1], segments[i]
        if cur.start_time < prev.start_time:
            add("time_order", "error", "Нарушен порядок времени сегментов", "error", cur.id)

    # 6. Кросстолки
    for seg in segments:
        if seg.is_crosstalk:
            add("crosstalk", "info", f"Сегмент #{seg.id} отмечен как кросстолк", "info", seg.id)

    # 7. Подозрительные термины (латиница в русском тексте, аббревиатуры)
    for seg in segments:
        issues = check_terms_in_text(seg.text)
        for issue in issues:
            add("suspicious_term", "warning",
                f"Сегмент #{seg.id}: {issue}", "warning", seg.id)

    # 8. Низкая уверенность ASR
    for seg in segments:
        if seg.confidence is not None and seg.confidence < 0.6:
            add("low_confidence", "info",
                f"Сегмент #{seg.id}: низкая уверенность ASR ({seg.confidence:.2f})", "info", seg.id)

    # 9. Повторяющиеся слова (подозрительные повторы)
    for seg in segments:
        reps = find_repeats(seg.text)
        for rep in reps:
            add("repetition", "info", f"Сегмент #{seg.id}: возможный повтор «{rep}»", "info", seg.id)

    db.add_all(checks)
    db.commit()
    return checks


def check_terms_in_text(text: str) -> List[str]:
    """Ищет подозрительные термины в тексте."""
    issues: List[str] = []
    if not text:
        return issues
    words = text.split()
    for w in words:
        clean = w.strip(".,!?;:()\"'«»-")
        if not clean:
            continue
        # латиница в русскоязычном тексте
        has_latin = any("a" <= c.lower() <= "z" for c in clean)
        has_cyrillic = any("а" <= c.lower() <= "я" for c in clean)
        if has_latin and has_cyrillic:
            issues.append(f"смешанная латиница/кириллица: «{clean}»")
        elif has_latin and len(clean) > 1 and clean.isupper():
            issues.append(f"аббревиатура: «{clean}»")
    return issues


def find_repeats(text: str) -> List[str]:
    """Ищет подозрительные повторы слов (например, «да да»)."""
    if not text:
        return []
    words = [w.strip(".,!?;:()\"'«»-").lower() for w in text.split()]
    reps = []
    for i in range(1, len(words)):
        if words[i] == words[i - 1] and len(words[i]) > 1:
            reps.append(words[i])
    return list(dict.fromkeys(reps))


def fmt(t: float) -> str:
    m = int(t // 60)
    s = t - m * 60
    return f"{m}:{s:05.2f}"
