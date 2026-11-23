"""Media API: загрузка аудио/видео, waveform, стриминг."""
import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .. import models, schemas
from ..config import UPLOAD_DIR
from ..database import get_db
from ..deps import require_any, require_supervisor, token_or_header_user
from ..services.audit import log
from ..services.waveform import compute_peaks, get_audio_duration

router = APIRouter(prefix="/media", tags=["media"])

AUDIO_EXTS = {".wav", ".mp3", ".ogg", ".flac", ".m4a"}
VIDEO_EXTS = {".mp4", ".webm", ".mov", ".mkv"}


@router.get("", response_model=list[schemas.MediaOut])
def list_media(
    project_id: int | None = None,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_supervisor),
):
    """Список загруженных медиафайлов (для выбора при создании задачи)."""
    q = db.query(models.MediaFile)
    if project_id:
        q = q.filter(models.MediaFile.project_id == project_id)
    return q.order_by(models.MediaFile.id.desc()).all()


@router.post("/upload", response_model=schemas.MediaOut)
def upload_media(
    file: UploadFile = File(...),
    project_id: int | None = Form(None),
    db: Session = Depends(get_db),
    user: models.User = Depends(require_supervisor),
):
    ext = Path(file.filename or "audio.wav").suffix.lower()
    if ext not in AUDIO_EXTS and ext not in VIDEO_EXTS:
        raise HTTPException(status_code=400, detail="Неподдерживаемый формат файла")

    is_video = ext in VIDEO_EXTS
    unique = uuid.uuid4().hex[:12]
    filename = f"{unique}{ext}"
    dest = UPLOAD_DIR / filename
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    media = models.MediaFile(
        project_id=project_id,
        audio_path=str(dest) if not is_video else "",
        video_path=str(dest) if is_video else "",
        original_name=file.filename or filename,
        format=ext.lstrip("."),
    )
    if not is_video:
        media.duration = get_audio_duration(str(dest))
    db.add(media)
    db.commit()
    db.refresh(media)
    log(db, user, "media", media.id, "upload", new_value=media.original_name)
    return media


@router.get("/{media_id}", response_class=FileResponse)
def get_media(media_id: int, db: Session = Depends(get_db), user: models.User = Depends(token_or_header_user)):
    media = db.get(models.MediaFile, media_id)
    if media is None:
        raise HTTPException(status_code=404, detail="Файл не найден")
    path = media.audio_path or media.video_path
    if not path or not Path(path).exists():
        raise HTTPException(status_code=404, detail="Файл не найден на диске")
    return FileResponse(path, media_type="application/octet-stream", filename=media.original_name)


@router.get("/{media_id}/info", response_model=schemas.MediaOut)
def get_media_info(media_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_any)):
    media = db.get(models.MediaFile, media_id)
    if media is None:
        raise HTTPException(status_code=404, detail="Файл не найден")
    return media


@router.get("/{media_id}/waveform")
def get_waveform(media_id: int, db: Session = Depends(get_db), user: models.User = Depends(token_or_header_user)):
    media = db.get(models.MediaFile, media_id)
    if media is None:
        raise HTTPException(status_code=404, detail="Файл не найден")
    path = media.audio_path or media.video_path
    peaks = compute_peaks(path) if path else []
    return {
        "media_id": media.id,
        "duration": media.duration or get_audio_duration(path or ""),
        "peaks": peaks,
        "sample_rate": 50,
    }


@router.delete("/{media_id}")
def delete_media(media_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_supervisor)):
    media = db.get(models.MediaFile, media_id)
    if media is None:
        raise HTTPException(status_code=404, detail="Файл не найден")
    for p in (media.audio_path, media.video_path):
        if p and Path(p).exists():
            Path(p).unlink(missing_ok=True)
    db.delete(media)
    db.commit()
    log(db, user, "media", media_id, "delete")
    return {"ok": True}
