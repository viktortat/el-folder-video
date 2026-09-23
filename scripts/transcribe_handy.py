#!/usr/bin/env python3
"""Транскрибация видео моделью Handy Parakeet TDT 0.6B v3 (GGUF/Vulkan)."""

from __future__ import annotations

import argparse
import ctypes
import json
import os
import subprocess
import tempfile
from pathlib import Path


DEFAULT_MODEL_ROOT = Path.home() / ".cache" / "huggingface" / "hub" / "models--handy-computer--parakeet-tdt-0.6b-v3-gguf" / "snapshots"
DEFAULT_DLL = Path(__file__).resolve().parents[1] / "tools" / "transcribe-cpp" / "transcribe-native-windows-x86_64-cpu-vulkan" / "transcribe.dll"


class Segment(ctypes.Structure):
    _fields_ = [("struct_size", ctypes.c_uint64), ("t0_ms", ctypes.c_int64), ("t1_ms", ctypes.c_int64), ("first_word", ctypes.c_int), ("n_words", ctypes.c_int), ("first_token", ctypes.c_int), ("n_tokens", ctypes.c_int), ("text", ctypes.c_char_p), ("speaker_id", ctypes.c_int32)]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("--output-dir", type=Path, default=Path(r"G:\_0000"))
    parser.add_argument("--output-stem", default=None, help="Базовое имя файлов результатов без расширения")
    parser.add_argument("--model", type=Path, default=None, help="Путь к GGUF; по умолчанию используется модель Handy из HF-кэша")
    parser.add_argument("--dll", type=Path, default=DEFAULT_DLL, help="Путь к transcribe.dll")
    return parser.parse_args()


def find_model(explicit: Path | None) -> Path:
    if explicit:
        return explicit.expanduser()
    candidates = list(DEFAULT_MODEL_ROOT.glob("*/parakeet-tdt-0.6b-v3-Q8_0.gguf"))
    if not candidates:
        raise FileNotFoundError("Модель Handy Parakeet не найдена в ~/.cache/huggingface/hub")
    return candidates[0]


def load_api(dll_path: Path):
    if not dll_path.is_file():
        raise FileNotFoundError(f"transcribe.dll не найден: {dll_path}")
    if hasattr(os, "add_dll_directory"):
        os.add_dll_directory(str(dll_path.parent))
    api = ctypes.CDLL(str(dll_path))
    api.transcribe_init_backends_default.argtypes, api.transcribe_init_backends_default.restype = [], ctypes.c_int
    api.transcribe_open.argtypes, api.transcribe_open.restype = [ctypes.c_char_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)], ctypes.c_int
    api.transcribe_run.argtypes, api.transcribe_run.restype = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_float), ctypes.c_int, ctypes.c_void_p], ctypes.c_int
    api.transcribe_full_text.argtypes, api.transcribe_full_text.restype = [ctypes.c_void_p], ctypes.c_char_p
    api.transcribe_n_segments.argtypes, api.transcribe_n_segments.restype = [ctypes.c_void_p], ctypes.c_int
    api.transcribe_segment_init.argtypes = [ctypes.POINTER(Segment)]
    api.transcribe_get_segment.argtypes, api.transcribe_get_segment.restype = [ctypes.c_void_p, ctypes.c_int, ctypes.POINTER(Segment)], ctypes.c_int
    api.transcribe_status_string.argtypes, api.transcribe_status_string.restype = [ctypes.c_int], ctypes.c_char_p
    api.transcribe_session_free.argtypes = [ctypes.c_void_p]
    return api


def status(api, code: int) -> str:
    value = api.transcribe_status_string(code)
    return value.decode("utf-8", errors="replace") if value else str(code)


def make_wav(video: Path, target: Path) -> None:
    command = ["ffmpeg", "-y", "-i", str(video), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_f32le", "-f", "f32le", str(target)]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f"ffmpeg не смог извлечь аудио:\n{result.stderr[-2000:]}")


def transcribe(api, model: Path, wav_path: Path) -> tuple[str, list[dict]]:
    init_status = api.transcribe_init_backends_default()
    if init_status:
        raise RuntimeError(f"Не удалось инициализировать backend: {status(api, init_status)}")
    session = ctypes.c_void_p()
    open_status = api.transcribe_open(os.fsencode(str(model)), None, None, ctypes.byref(session))
    if open_status:
        raise RuntimeError(f"Не удалось загрузить модель: {status(api, open_status)}")
    try:
        raw = wav_path.read_bytes()
        all_samples = len(raw) // 4
        chunk_samples = 15 * 16000
        texts = []
        segments = []
        for chunk_start in range(0, all_samples, chunk_samples):
            chunk = raw[chunk_start * 4 : min(all_samples, chunk_start + chunk_samples) * 4]
            samples = (ctypes.c_float * (len(chunk) // 4)).from_buffer_copy(chunk)
            run_status = api.transcribe_run(session, samples, len(samples), None)
            if run_status:
                raise RuntimeError(f"Ошибка транскрибации фрагмента {chunk_start // 16000}s: {status(api, run_status)}")
            chunk_text = (api.transcribe_full_text(session) or b"").decode("utf-8", errors="replace").strip()
            if chunk_text:
                texts.append(chunk_text)
            for index in range(api.transcribe_n_segments(session)):
                segment = Segment()
                api.transcribe_segment_init(ctypes.byref(segment))
                if api.transcribe_get_segment(session, index, ctypes.byref(segment)) == 0:
                    segments.append({"start": chunk_start / 16000 + segment.t0_ms / 1000, "end": chunk_start / 16000 + segment.t1_ms / 1000, "text": (segment.text or b"").decode("utf-8", errors="replace").strip()})
            print(f"PROGRESS:{min(chunk_start + chunk_samples, all_samples) / 16000:.0f}:{all_samples / 16000:.0f}", flush=True)
        return "\n\n".join(texts), segments
    finally:
        api.transcribe_session_free(session)


def srt_time(seconds: float) -> str:
    milliseconds = round(seconds * 1000)
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{millis:03}"


def main() -> int:
    options = parse_args()
    video = options.video.expanduser()
    if not video.is_file():
        raise FileNotFoundError(f"Видео не найдено: {video}")
    model = find_model(options.model)
    api = load_api(options.dll)
    options.output_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="parakeet-") as temp_dir:
        wav_path = Path(temp_dir) / "audio.wav"
        print(f"Модель: {model}")
        print("Извлечение аудио...")
        make_wav(video, wav_path)
        print("Транскрибация через Handy/transcribe.cpp...")
        text, segments = transcribe(api, model, wav_path)
    stem = options.output_stem or video.stem
    txt_path, srt_path, json_path = (options.output_dir / f"{stem}{suffix}" for suffix in (".txt", ".srt", ".json"))
    txt_path.write_text(text + "\n", encoding="utf-8")
    srt_lines = []
    for index, segment in enumerate(segments, 1):
        if segment["text"]:
            srt_lines.extend([str(index), f"{srt_time(segment['start'])} --> {srt_time(segment['end'])}", segment["text"], ""])
    srt_path.write_text("\n".join(srt_lines), encoding="utf-8")
    json_path.write_text(json.dumps({"video": str(video), "model": str(model), "text": text, "segments": segments}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Готово: {txt_path}")
    print(f"Готово: {srt_path}")
    print(f"Готово: {json_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
