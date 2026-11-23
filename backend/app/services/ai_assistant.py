"""AI-помощник (mock-реализация на основе эвристик).

Не изменяет данные автоматически — только выдаёт подсказки.
"""
import re
from typing import List

from .. import models
from ..schemas import AIHint

# Словарь типовых технических терминов (YADRO и др.)
TECH_TERMS = {
    "yadro": "YADRO",
    "tatlin": "TATLIN",
    "vegman": "VEGMAN",
    "unified": "UNIFIED",
    "backup": "BACKUP",
    "flex": "FLEX",
    "archive": "ARCHIVE",
    "ci/cd": "CI/CD",
    "json": "JSON",
    "csv": "CSV",
    "ini": "INI",
    "asn1": "ASN.1",
    "api": "API",
    "ip": "IP",
    "ssd": "SSD",
}

# Слова-паразиты и короткие реплики
FILLER_WORDS = {"ну", "вот", "как бы", "типа", "значит", "это самое", "короче"}
SHORT_REPLIES = {"да", "нет", "угу", "ага", "ну да", "конечно", "ладно", "ок", "окей"}


def generate_hints(task: models.Task, segments: List[models.Segment]) -> List[AIHint]:
    """Генерирует подсказки для задачи."""
    hints: List[AIHint] = []
    segs = sorted(segments, key=lambda s: s.start_time)

    # 1. Сегменты без текста
    for seg in segs:
        if not seg.text.strip():
            hints.append(AIHint(
                segment_id=seg.id, type="no_text",
                message=f"Сегмент {fmt(seg.start_time)}–{fmt(seg.end_time)} не содержит текста. "
                        "Прослушайте и добавьте транскрипцию или удалите сегмент.",
                severity="warning",
            ))

    # 2. Длинные паузы — возможна пропущенная речь
    for i in range(1, len(segs)):
        gap = segs[i].start_time - segs[i - 1].end_time
        if gap > 3.0:
            hints.append(AIHint(
                segment_id=segs[i].id, type="missed_speech",
                message=f"Пауза {gap:.1f} с между сегментами. Возможно, пропущена речь — прослушайте участок.",
                severity="warning",
            ))

    # 3. Обрезанные слова (короткий сегмент с текстом)
    for seg in segs:
        dur = seg.end_time - seg.start_time
        if 0 < dur < 0.5 and seg.text.strip():
            hints.append(AIHint(
                segment_id=seg.id, type="truncated_word",
                message=f"Сегмент очень короткий ({dur:.2f} с). Проверьте, не обрезано ли слово на границах.",
                severity="warning",
            ))

    # 4. Низкая уверенность ASR
    for seg in segs:
        if seg.confidence is not None and seg.confidence < 0.6:
            hints.append(AIHint(
                segment_id=seg.id, type="low_confidence",
                message=f"Низкая уверенность ASR ({seg.confidence:.0%}). Проверьте текст сегмента.",
                severity="info",
            ))

    # 5. Технические термины в нижнем регистре
    for seg in segs:
        for word, correct in TECH_TERMS.items():
            pattern = re.compile(rf"\b{re.escape(word)}\b", re.IGNORECASE)
            if pattern.search(seg.text):
                hints.append(AIHint(
                    segment_id=seg.id, type="term_case",
                    message=f"Термин «{word}» в тексте. По правилам проекта пишется как «{correct}».",
                    severity="info",
                    suggestion=correct,
                ))

    # 6. Слова-паразиты
    for seg in segs:
        for filler in FILLER_WORDS:
            if re.search(rf"\b{re.escape(filler)}\b", seg.text, re.IGNORECASE):
                hints.append(AIHint(
                    segment_id=seg.id, type="filler",
                    message=f"Обнаружено слово-паразит «{filler}». По правилам слова-паразиты сохраняются.",
                    severity="info",
                ))

    # 7. Короткие реплики
    for seg in segs:
        words = [w.strip(".,!?;:()\"'«»-").lower() for w in seg.text.split()]
        if len(words) == 1 and words[0] in SHORT_REPLIES:
            hints.append(AIHint(
                segment_id=seg.id, type="short_reply",
                message=f"Короткая реплика «{words[0]}». Значимые короткие реплики сохраняются.",
                severity="info",
            ))

    # 8. Пунктуация: предложение с маленькой буквы
    for seg in segs:
        t = seg.text.strip()
        if t and t[0].islower():
            hints.append(AIHint(
                segment_id=seg.id, type="capitalization",
                message="Предложение должно начинаться с большой буквы.",
                severity="info",
                suggestion=t[0].upper() + t[1:],
            ))

    # 9. Повторы
    for seg in segs:
        words = [w.strip(".,!?;:()\"'«»-").lower() for w in seg.text.split()]
        for i in range(1, len(words)):
            if words[i] == words[i - 1] and len(words[i]) > 1:
                hints.append(AIHint(
                    segment_id=seg.id, type="repetition",
                    message=f"Подозрительный повтор «{words[i]}». Проверьте соответствие аудио.",
                    severity="info",
                ))

    # 10. Кросстолки
    for seg in segs:
        if seg.is_crosstalk:
            hints.append(AIHint(
                segment_id=seg.id, type="crosstalk",
                message="Сегмент отмечен как кросстолк. Речь нескольких спикеров записывается по порядку произнесения.",
                severity="info",
            ))

    return hints


def fmt(t: float) -> str:
    m = int(t // 60)
    s = t - m * 60
    return f"{m}:{s:05.2f}"
