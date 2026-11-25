"""Вычисление waveform-пиков и длительности из аудио/видеофайла.

WAV читается штатным модулем ``wave`` (быстро, без внешних зависимостей).
Для остальных форматов (ogg/mp3/flac/m4a и дорожек из видео) используется
``ffmpeg``, если он доступен в системе. Если ffmpeg нет — функции возвращают
пустой результат, не ломая приложение.
"""
import os
import shutil
import subprocess
import wave
from pathlib import Path
from typing import List, Optional

import numpy as np

PEAKS_PER_SECOND = 50  # 50 пиков в секунду — достаточно для точного отображения

# Путь к ffmpeg/ffprobe: из PATH или из переменной окружения GECKO_FFMPEG/GECKO_FFPROBE.
FFMPEG = os.getenv("GECKO_FFMPEG") or shutil.which("ffmpeg")
FFPROBE = os.getenv("GECKO_FFPROBE") or shutil.which("ffprobe")

DECODE_RATE = 16000  # частота дискретизации при декодировании для waveform


def _finalize_peaks(peaks: List[float], max_peaks: int) -> List[float]:
    """Нормализация [0..1] и прореживание до max_peaks."""
    if not peaks:
        return []
    max_val = max(peaks)
    if max_val > 0:
        peaks = [min(1.0, p / max_val) for p in peaks]
    if len(peaks) > max_peaks:
        step = len(peaks) / max_peaks
        peaks = [peaks[int(i * step)] for i in range(max_peaks)]
    return peaks


def _peaks_from_wave(path: Path, max_peaks: int) -> List[float]:
    """Пики из WAV-файла (штатный модуль wave), чтение порциями."""
    with wave.open(str(path), "rb") as wf:
        n_channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        framerate = wf.getframerate()
        n_frames = wf.getnframes()

        if sampwidth == 1:
            dtype = np.uint8
            scale = 128.0
        elif sampwidth == 2:
            dtype = np.int16
            scale = 32768.0
        else:
            return []

        chunk_frames = int(framerate * 5)  # 5 секунд за раз
        peaks: List[float] = []
        frames_per_peak = max(1, int(framerate / PEAKS_PER_SECOND))

        offset = 0
        while offset < n_frames:
            wf.setpos(offset)
            data = wf.readframes(min(chunk_frames, n_frames - offset))
            if not data:
                break
            arr = np.frombuffer(data, dtype=dtype).astype(np.float32)
            if n_channels > 1:
                arr = arr.reshape(-1, n_channels).mean(axis=1)
            arr = np.abs(arr) / scale
            n_windows = max(1, len(arr) // frames_per_peak)
            if n_windows > 0:
                trimmed = arr[: n_windows * frames_per_peak]
                windows = trimmed.reshape(n_windows, frames_per_peak)
                peaks.extend(windows.max(axis=1).tolist())
            offset += chunk_frames

    return _finalize_peaks(peaks, max_peaks)


def _peaks_from_ffmpeg(path: Path, max_peaks: int) -> Optional[List[float]]:
    """Пики из любого формата через ffmpeg (декодирование потоком в s16le mono)."""
    if not FFMPEG:
        return None
    cmd = [
        FFMPEG, "-v", "error", "-i", str(path),
        "-f", "s16le", "-ac", "1", "-ar", str(DECODE_RATE), "-",
    ]
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    except Exception:
        return None

    frames_per_peak = max(1, int(DECODE_RATE / PEAKS_PER_SECOND))
    chunk_bytes = DECODE_RATE * 2 * 5  # ~5 секунд PCM
    peaks: List[float] = []
    buf = b""
    try:
        while True:
            block = proc.stdout.read(chunk_bytes)
            if not block:
                break
            buf += block
            n_samples = len(buf) // 2
            n_windows = n_samples // frames_per_peak
            if n_windows > 0:
                usable = n_windows * frames_per_peak * 2
                arr = np.frombuffer(buf[:usable], dtype=np.int16).astype(np.float32) / 32768.0
                windows = np.abs(arr).reshape(n_windows, frames_per_peak)
                peaks.extend(windows.max(axis=1).tolist())
                buf = buf[usable:]
    finally:
        try:
            proc.stdout.close()
        except Exception:
            pass
        proc.wait()

    return _finalize_peaks(peaks, max_peaks)


def compute_peaks(audio_path: str, max_peaks: int = 6000) -> List[float]:
    """Возвращает список нормализованных пиков [0..1] для отображения waveform."""
    path = Path(audio_path)
    if not path.exists():
        return []

    # Быстрый путь для WAV
    if path.suffix.lower() == ".wav":
        try:
            return _peaks_from_wave(path, max_peaks)
        except Exception:
            pass

    # Другие форматы — через ffmpeg
    try:
        result = _peaks_from_ffmpeg(path, max_peaks)
        if result:
            return result
    except Exception:
        pass

    # Последняя попытка: файл без расширения, но WAV-содержимое
    try:
        return _peaks_from_wave(path, max_peaks)
    except Exception:
        return []


def get_audio_duration(audio_path: str) -> float:
    path = Path(audio_path)
    if not path.exists():
        return 0.0

    # WAV — штатно и точно
    if path.suffix.lower() == ".wav":
        try:
            with wave.open(str(path), "rb") as wf:
                return wf.getnframes() / wf.getframerate()
        except Exception:
            pass

    # ffprobe — самый быстрый способ для остальных форматов
    if FFPROBE:
        try:
            out = subprocess.run(
                [FFPROBE, "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=nw=1:nk=1", str(path)],
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=30,
            ).stdout.strip()
            if out and out != "N/A":
                return float(out)
        except Exception:
            pass

    # ffmpeg — декодируем и считаем семплы (для видео/нестандартных контейнеров)
    if FFMPEG:
        try:
            cmd = [FFMPEG, "-v", "error", "-i", str(path),
                   "-f", "s16le", "-ac", "1", "-ar", str(DECODE_RATE), "-"]
            proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=300)
            if proc.returncode == 0 and proc.stdout:
                return len(proc.stdout) / 2 / DECODE_RATE
        except Exception:
            pass

    # Фолбэк для WAV без расширения
    try:
        with wave.open(str(path), "rb") as wf:
            return wf.getnframes() / wf.getframerate()
    except Exception:
        return 0.0
