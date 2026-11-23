"""Segments API: CRUD, split, merge, загрузка предразметки."""
import json

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import require_annotator, require_any, require_editor
from ..services.audit import log

router = APIRouter(prefix="/segments", tags=["segments"])


def _seg_out(s: models.Segment) -> schemas.SegmentOut:
    return schemas.SegmentOut(
        id=s.id, task_id=s.task_id, start_time=s.start_time, end_time=s.end_time,
        text=s.text, speaker_name=s.speaker_name, status=s.status,
        confidence=s.confidence, is_crosstalk=s.is_crosstalk, comment=s.comment,
        order_index=s.order_index,
    )


@router.get("/task/{task_id}", response_model=list[schemas.SegmentOut])
def list_segments(task_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_any)):
    segs = db.query(models.Segment).filter(models.Segment.task_id == task_id).order_by(models.Segment.start_time).all()
    return [_seg_out(s) for s in segs]


@router.post("", response_model=schemas.SegmentOut)
def create_segment(data: schemas.SegmentIn, db: Session = Depends(get_db), user: models.User = Depends(require_annotator)):
    task = db.get(models.Task, data.task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    max_order = db.query(models.Segment).filter(models.Segment.task_id == data.task_id).count()
    seg = models.Segment(
        task_id=data.task_id,
        start_time=round(data.start_time, 2),
        end_time=round(data.end_time, 2),
        text=data.text,
        speaker_name=data.speaker_name,
        confidence=data.confidence,
        is_crosstalk=data.is_crosstalk,
        status=data.status,
        order_index=max_order,
    )
    db.add(seg)
    db.commit()
    db.refresh(seg)
    log(db, user, "segment", seg.id, "create", new_value=f"{seg.start_time}-{seg.end_time}")
    return _seg_out(seg)


@router.put("/{segment_id}", response_model=schemas.SegmentOut)
def update_segment(
    segment_id: int,
    data: schemas.SegmentUpdate,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_editor),
):
    seg = db.get(models.Segment, segment_id)
    if seg is None:
        raise HTTPException(status_code=404, detail="Сегмент не найден")

    changes = data.model_dump(exclude_unset=True)
    for field, value in changes.items():
        if field in ("start_time", "end_time") and value is not None:
            value = round(value, 2)
        old = getattr(seg, field)
        if old != value:
            db.add(models.SegmentEdit(
                segment_id=seg.id, user_id=user.id, field=field,
                old_value=str(old), new_value=str(value),
            ))
            setattr(seg, field, value)
    db.commit()
    db.refresh(seg)
    log(db, user, "segment", seg.id, "update", new_value=json.dumps(changes, ensure_ascii=False))
    return _seg_out(seg)


@router.delete("/{segment_id}")
def delete_segment(segment_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_annotator)):
    seg = db.get(models.Segment, segment_id)
    if seg is None:
        raise HTTPException(status_code=404, detail="Сегмент не найден")
    db.delete(seg)
    db.commit()
    log(db, user, "segment", segment_id, "delete")
    return {"ok": True}


@router.post("/{segment_id}/split", response_model=list[schemas.SegmentOut])
def split_segment(
    segment_id: int,
    data: schemas.SplitIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_annotator),
):
    seg = db.get(models.Segment, segment_id)
    if seg is None:
        raise HTTPException(status_code=404, detail="Сегмент не найден")
    at = round(data.at_time, 2)
    if not (seg.start_time < at < seg.end_time):
        raise HTTPException(status_code=400, detail="Точка разделения вне границ сегмента")

    old_end = seg.end_time
    seg.end_time = at
    new_seg = models.Segment(
        task_id=seg.task_id,
        start_time=at,
        end_time=old_end,
        text="",
        speaker_name=seg.speaker_name,
        confidence=seg.confidence,
        is_crosstalk=seg.is_crosstalk,
        status="pending",
        order_index=seg.order_index + 1,
    )
    db.add(new_seg)
    db.commit()
    log(db, user, "segment", seg.id, "split", new_value=f"at={at}")
    segs = db.query(models.Segment).filter(models.Segment.task_id == seg.task_id).order_by(models.Segment.start_time).all()
    return [_seg_out(s) for s in segs]


@router.post("/merge", response_model=list[schemas.SegmentOut])
def merge_segments(
    data: schemas.MergeIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_annotator),
):
    if len(data.segment_ids) < 2:
        raise HTTPException(status_code=400, detail="Нужно минимум 2 сегмента")
    segs = db.query(models.Segment).filter(models.Segment.id.in_(data.segment_ids)).order_by(models.Segment.start_time).all()
    if len(segs) < 2:
        raise HTTPException(status_code=404, detail="Сегменты не найдены")

    first = segs[0]
    first.end_time = segs[-1].end_time
    first.text = " ".join(s.text.strip() for s in segs if s.text.strip())
    first.is_crosstalk = any(s.is_crosstalk for s in segs)
    db.add(first)
    for s in segs[1:]:
        db.delete(s)
    db.commit()
    log(db, user, "segment", first.id, "merge", new_value=str(data.segment_ids))
    result = db.query(models.Segment).filter(models.Segment.task_id == first.task_id).order_by(models.Segment.start_time).all()
    return [_seg_out(s) for s in result]


@router.post("/task/{task_id}/import")
def import_preannotation(
    task_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: models.User = Depends(require_annotator),
):
    """Импорт JSON-предразметки Gecko: создаёт сегменты и спикеров."""
    task = db.get(models.Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Задача не найдена")

    try:
        raw = file.file.read().decode("utf-8")
        data = json.loads(raw)
    except Exception:
        raise HTTPException(status_code=400, detail="Некорректный JSON")

    segments = data.get("segments") or data.get("items") or []
    if not segments and isinstance(data, list):
        segments = data

    # очищаем старые сегменты
    db.query(models.Segment).filter(models.Segment.task_id == task_id).delete()

    speakers_map = {}
    for i, item in enumerate(segments):
        start = float(item.get("start", item.get("start_time", 0)))
        end = float(item.get("end", item.get("end_time", start + 1)))
        text = item.get("text", "")
        speaker = item.get("speaker", item.get("speaker_name", ""))
        confidence = float(item.get("confidence", 1.0) or 1.0)
        is_crosstalk = bool(item.get("is_crosstalk", False))

        speaker_id = None
        if speaker:
            if speaker not in speakers_map:
                sp = models.Speaker(task_id=task_id, original_name=speaker, display_name=speaker)
                db.add(sp)
                db.flush()
                speakers_map[speaker] = sp.id
            speaker_id = speakers_map[speaker]

        db.add(models.Segment(
            task_id=task_id, start_time=round(start, 2), end_time=round(end, 2),
            text=text, speaker_id=speaker_id, speaker_name=speaker,
            confidence=confidence, is_crosstalk=is_crosstalk, order_index=i,
        ))

    task.source_json = raw
    db.add(models.Transcript(task_id=task_id, source_json=raw, current_json=raw, version=1))
    db.commit()
    log(db, user, "task", task_id, "import_preannotation", new_value=f"{len(segments)} segments")
    return {"ok": True, "imported": len(segments)}
