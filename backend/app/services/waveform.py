"""Вычисление waveform-пиков из аудиофайла."""
import math
import wave
from pathlib import Path
from typing import List, Optional

import numpy as np

PEAKS_PER_SECOND = 50  # 50 пиков в секунду — достаточно для точного отображения


def compute_peaks(audio_path: str, max_peaks: int = 6000) -> List[float]:
    """Возвращает список нормализованных пиков [0..1] для отображения waveform."""
    path = Path(audio_path)
    if not path.exists():
        return []

    try:
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

            # читаем файл порциями, чтобы не грузить всё в память
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
                # усредняем по окнам
                n_windows = max(1, len(arr) // frames_per_peak)
                if n_windows > 0:
                    trimmed = arr[: n_windows * frames_per_peak]
                    windows = trimmed.reshape(n_windows, frames_per_peak)
                    peaks.extend(windows.max(axis=1).tolist())
                offset += chunk_frames

            if not peaks:
                return []

            # нормализация
            max_val = max(peaks)
            if max_val > 0:
                peaks = [min(1.0, p / max_val) for p in peaks]

            # прореживание до max_peaks
            if len(peaks) > max_peaks:
                step = len(peaks) / max_peaks
                peaks = [peaks[int(i * step)] for i in range(max_peaks)]

            return peaks
    except Exception:
        return []


def get_audio_duration(audio_path: str) -> float:
    path = Path(audio_path)
    if not path.exists():
        return 0.0
    try:
        with wave.open(str(path), "rb") as wf:
            return wf.getnframes() / wf.getframerate()
    except Exception:
        return 0.0
