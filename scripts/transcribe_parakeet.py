#!/usr/bin/env python3
"""Транскрибация видео локальной моделью NVIDIA Parakeet TDT 0.6B v3.

Модель должна быть заранее скачана Handy или указана как локальный каталог/файл
через --model. По умолчанию используется имя модели Hugging Face, но включён
offline-режим, поэтому скрипт не скачивает её сам.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path, help="Путь к видеофайлу")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(r"G:\_0000"),
        help=r"Каталог результатов (по умолчанию: G:\_0000)",
    )
    parser.add_argument(
        "--model",
        default="nvidia/parakeet-tdt-0.6b-v3",
        help="Локальный путь к модели или её имя в локальном кэше",
    )
    parser.add_argument(
        "--language",
        default="ru",
        help="Язык транскрибации, по умолчанию ru",
    )
    return parser.parse_args()


def load_model(model_name: str):
    # Handy использует семейство Parakeet. NeMo читает ту же модель из
    # локального каталога/кэша Hugging Face и не требует сетевого доступа.
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    try:
        import nemo.collections.asr as nemo_asr
    except ImportError as error:
        raise RuntimeError(
            "Не найден NVIDIA NeMo. Установите совместимую сборку NeMo для "
            "вашей версии Python/CUDA, затем повторите запуск."
        ) from error

    try:
        return nemo_asr.models.ASRModel.from_pretrained(
            model_name=model_name,
            map_location="cuda",
        )
    except Exception as cuda_error:
        print(f"CUDA недоступна, пробую CPU: {cuda_error}", file=sys.stderr)
        return nemo_asr.models.ASRModel.from_pretrained(
            model_name=model_name,
            map_location="cpu",
        )


def write_results(output_dir: Path, video: Path, hypotheses) -> tuple[Path, Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = video.stem
    txt_path = output_dir / f"{stem}.txt"
    srt_path = output_dir / f"{stem}.srt"
    json_path = output_dir / f"{stem}.json"

    hypothesis = hypotheses[0]
    text = getattr(hypothesis, "text", str(hypothesis)).strip()
    txt_path.write_text(text + "\n", encoding="utf-8")

    # Parakeet/NeMo может вернуть таймкоды сегментов; если их нет, сохраняем
    # полный текст в одном SRT-сегменте, чтобы результат был сразу пригоден.
    raw_timestamps = getattr(hypothesis, "timestamp", {}) or {}
    segments = raw_timestamps.get("segment", []) if isinstance(raw_timestamps, dict) else []
    srt_lines = []
    if segments:
        for index, segment in enumerate(segments, 1):
            start = float(segment["start"])
            end = float(segment["end"])
            segment_text = str(segment.get("segment", "")).strip()
            if segment_text:
                srt_lines.extend([str(index), f"{srt_time(start)} --> {srt_time(end)}", segment_text, ""])
    else:
        srt_lines = ["1", "00:00:00,000 --> 99:59:59,999", text, ""]
    srt_path.write_text("\n".join(srt_lines), encoding="utf-8")

    json_path.write_text(
        json.dumps({"video": str(video), "text": text, "segments": segments}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return txt_path, srt_path, json_path


def srt_time(seconds: float) -> str:
    milliseconds = round(seconds * 1000)
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{millis:03}"


def main() -> int:
    args = parse_args()
    video = args.video.expanduser()
    if not video.is_file():
        print(f"Видео не найдено: {video}", file=sys.stderr)
        return 2

    print(f"Загрузка локальной модели: {args.model}")
    model = load_model(args.model)
    model.eval()
    print(f"Транскрибация: {video}")
    hypotheses = model.transcribe([str(video)], batch_size=1, return_hypotheses=True)
    paths = write_results(args.output_dir, video, hypotheses)
    print("Готово:")
    for path in paths:
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
