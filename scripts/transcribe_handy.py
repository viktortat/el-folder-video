#!/usr/bin/env python3
"""Локальная транскрибация Parakeet TDT 0.6B v3 через transcribe.cpp."""

from __future__ import annotations

import argparse
import ctypes
import json
import os
import subprocess
from pathlib import Path


DEFAULT_MODEL_ROOT = Path.home() / ".cache" / "huggingface" / "hub" / "models--handy-computer--parakeet-tdt-0.6b-v3-gguf" / "snapshots"
DEFAULT_DLL = Path(__file__).resolve().parents[1] / "tools" / "transcribe-cpp" / "transcribe-native-windows-x86_64-cpu-vulkan" / "transcribe.dll"


class Segment(ctypes.Structure):
    _fields_ = [("struct_size", ctypes.c_uint64), ("t0_ms", ctypes.c_int64), ("t1_ms", ctypes.c_int64), ("first_word", ctypes.c_int), ("n_words", ctypes.c_int), ("first_token", ctypes.c_int), ("n_tokens", ctypes.c_int), ("text", ctypes.c_char_p), ("speaker_id", ctypes.c_int32)]


class Word(ctypes.Structure):
    _fields_ = [("struct_size", ctypes.c_uint64), ("t0_ms", ctypes.c_int64), ("t1_ms", ctypes.c_int64), ("seg_index", ctypes.c_int), ("first_token", ctypes.c_int), ("n_tokens", ctypes.c_int), ("text", ctypes.c_char_p)]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("--output-dir", type=Path, default=Path(r"G:\_0000"))
    parser.add_argument("--output-stem", default=None, help="Базовое имя файлов результатов без расширения")
    parser.add_argument("--model", type=Path, default=None, help="Путь к GGUF; по умолчанию ищется Parakeet TDT в кэше HuggingFace")
    parser.add_argument("--dll", type=Path, default=DEFAULT_DLL, help="Путь к transcribe.dll")
    return parser.parse_args()


def find_model(explicit: Path | None) -> Path:
    if explicit:
        model = explicit.expanduser()
        if not model.is_file():
            raise FileNotFoundError(f"Модель Parakeet не найдена: {model}")
        return model
    candidates = list(DEFAULT_MODEL_ROOT.glob("*/parakeet-tdt-0.6b-v3-Q8_0.gguf"))
    if not candidates:
        raise FileNotFoundError("Модель Parakeet TDT не найдена в кэше HuggingFace. Укажите GGUF-файл в настройках.")
    return candidates[0]


def load_api(dll_path: Path):
    dll_path = dll_path.resolve()
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
    api.transcribe_n_words.argtypes, api.transcribe_n_words.restype = [ctypes.c_void_p], ctypes.c_int
    api.transcribe_word_init.argtypes = [ctypes.POINTER(Word)]
    api.transcribe_get_word.argtypes, api.transcribe_get_word.restype = [ctypes.c_void_p, ctypes.c_int, ctypes.POINTER(Word)], ctypes.c_int
    api.transcribe_status_string.argtypes, api.transcribe_status_string.restype = [ctypes.c_int], ctypes.c_char_p
    api.transcribe_session_free.argtypes = [ctypes.c_void_p]
    return api


def status(api, code: int) -> str:
    value = api.transcribe_status_string(code)
    return value.decode("utf-8", errors="replace") if value else str(code)


def video_duration(video: Path) -> float:
    result = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(video)], capture_output=True, text=True)
    try:
        return max(0.0, float(result.stdout.strip()))
    except ValueError:
        return 0.0


def phrases(words: list[dict]) -> list[dict]:
    result = []
    current = []
    def close():
        if current:
            result.append({"start": current[0]["start"], "end": current[-1]["end"], "text": " ".join(word["text"] for word in current)})
            current.clear()
    for word in words:
        if current and (word["start"] - current[-1]["end"] > 1 or word["end"] - current[0]["start"] > 30):
            close()
        current.append(word)
        if word["text"].endswith((".", "!", "?", "…")):
            close()
    close()
    return result


def transcribe(api, model: Path, video: Path) -> tuple[str, list[dict]]:
    init_status = api.transcribe_init_backends_default()
    if init_status:
        raise RuntimeError(f"Не удалось инициализировать backend: {status(api, init_status)}")
    session = ctypes.c_void_p()
    open_status = api.transcribe_open(os.fsencode(str(model)), None, None, ctypes.byref(session))
    if open_status:
        raise RuntimeError(f"Не удалось загрузить модель: {status(api, open_status)}")
    try:
        duration = video_duration(video)
        command = ["ffmpeg", "-v", "error", "-i", str(video), "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1"]
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        words = []
        segments = []
        offset = 0.0
        try:
            while True:
                raw = process.stdout.read(15 * 16000 * 4)
                if not raw:
                    break
                samples = (ctypes.c_float * (len(raw) // 4)).from_buffer_copy(raw)
                run_status = api.transcribe_run(session, samples, len(samples), None)
                if run_status:
                    raise RuntimeError(f"Ошибка распознавания на {offset:.0f} с: {status(api, run_status)}")
                chunk_words = []
                for index in range(api.transcribe_n_words(session)):
                    word = Word()
                    api.transcribe_word_init(ctypes.byref(word))
                    if api.transcribe_get_word(session, index, ctypes.byref(word)) == 0:
                        text = (word.text or b"").decode("utf-8", errors="replace").strip()
                        if text:
                            chunk_words.append({"start": offset + word.t0_ms / 1000, "end": offset + word.t1_ms / 1000, "text": text})
                words.extend(chunk_words)
                if not chunk_words:
                    for index in range(api.transcribe_n_segments(session)):
                        segment = Segment()
                        api.transcribe_segment_init(ctypes.byref(segment))
                        if api.transcribe_get_segment(session, index, ctypes.byref(segment)) == 0:
                            text = (segment.text or b"").decode("utf-8", errors="replace").strip()
                            if text:
                                segments.append({"start": offset + segment.t0_ms / 1000, "end": offset + segment.t1_ms / 1000, "text": text})
                offset += len(raw) / (16000 * 4)
                print(f"PROGRESS:{offset:.2f}:{max(duration, offset):.2f}", flush=True)
            stderr = process.stderr.read().decode("utf-8", errors="replace")
            if process.wait() != 0:
                raise RuntimeError(f"ffmpeg не смог извлечь аудио: {stderr[-2000:]}")
            segments = sorted([*phrases(words), *segments], key=lambda segment: segment["start"])
            return "\n".join(segment["text"] for segment in segments), segments
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
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
    print(f"Модель Parakeet TDT: {model}")
    text, segments = transcribe(api, model, video)
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
