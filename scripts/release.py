#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Выпуск Windows-версии Folder-video.

Повышает version в package.json, собирает Squirrel-установщик через Bun,
коммитит версию и отправляет HEAD и тег в origin. Установщик публикуется
в viktortat/utils-releases, код остаётся в основном репозитории.

Запуск из любой папки (Python 3.11+; также работает uv run):
    python scripts/release.py
    python scripts/release.py --version 1.1.0 --notes "Что нового"
    python scripts/release.py --draft
    python scripts/release.py --dry-run

--dry-run собирает новую версию и возвращает исходный package.json;
коммит, тег, push и публикация не выполняются. Зависимости проекта должны
быть установлены. Для публикации нужны git, bun, gh и gh auth login.
Перед сборкой закройте приложение, если оно запущено из out.
"""

from __future__ import annotations

import argparse
import json
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKAGE_JSON = ROOT / "package.json"
SETUP_EXE = ROOT / "out" / "make" / "squirrel.windows" / "x64" / "folder-video-setup.exe"
RELEASES_REPO = "viktortat/utils-releases"
TAG_PREFIX = "folder-video-v"
STABLE_TAG = "folder-video-latest"
VERSION_RE = re.compile(rb'^(\s*"version"\s*:\s*")([^"\r\n]+)(")', re.MULTILINE)
SEMVER_RE = re.compile(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    print(f"$ {' '.join(cmd)}", flush=True)
    exe = shutil.which(cmd[0])
    if not exe:
        raise RuntimeError(f"Не найден {cmd[0]} в PATH")
    return subprocess.run([exe, *cmd[1:]], cwd=ROOT, check=True, **kwargs)


def version_parts(version: str) -> tuple[int, ...]:
    if not SEMVER_RE.fullmatch(version):
        raise ValueError(f"Версия должна быть вида X.Y.Z без ведущих нулей: «{version}»")
    return tuple(map(int, version.split(".")))


def next_version(current: str, requested: str | None) -> str:
    major, minor, patch = version_parts(current)
    version = requested if requested is not None else f"{major}.{minor}.{patch + 1}"
    if version_parts(version) <= (major, minor, patch):
        raise ValueError(f"Новая версия {version} должна быть больше текущей {current}")
    return version


def with_version(original: bytes, version: str) -> bytes:
    # Правим только значение: сохраняем BOM, отступы и исходные окончания строк.
    updated, count = VERSION_RE.subn(
        lambda match: match[1] + version.encode("ascii") + match[3], original, count=1
    )
    if count != 1 or json.loads(updated.decode("utf-8-sig"))["version"] != version:
        raise ValueError("Не удалось заменить version в package.json")
    return updated


def ensure_clean_git() -> None:
    result = run(["git", "status", "--porcelain"], capture_output=True, text=True)
    if result.stdout.strip():
        raise RuntimeError(
            "Сначала закоммитьте изменения. Релиз коммитит только package.json.\n"
            + result.stdout
        )


def preflight(tag: str) -> None:
    ensure_clean_git()
    run(["git", "symbolic-ref", "--quiet", "--short", "HEAD"], capture_output=True)
    run(["git", "remote", "get-url", "--push", "origin"], capture_output=True)
    local = run(["git", "tag", "--list", tag], capture_output=True, text=True)
    remote = run(
        ["git", "ls-remote", "--tags", "origin", f"refs/tags/{tag}"],
        capture_output=True, text=True,
    )
    if local.stdout.strip() or remote.stdout.strip():
        raise RuntimeError(f"Тег {tag} уже существует")
    run(["gh", "auth", "status"])


def build_installer() -> Path:
    # При неудачной сборке старый установщик не должен попасть в новый релиз.
    SETUP_EXE.unlink(missing_ok=True)
    run(["bun", "run", "make"])
    if not SETUP_EXE.is_file() or SETUP_EXE.stat().st_size == 0:
        raise RuntimeError(f"Не найден непустой установщик: {SETUP_EXE}")
    return SETUP_EXE


def publish_stable(built: Path, version: str) -> None:
    notes = f"Последняя версия Folder-video: {version}."
    # Читаем список, чтобы ошибка сети/авторизации не считалась отсутствием релиза.
    result = run(
        ["gh", "api", "--paginate", f"repos/{RELEASES_REPO}/releases",
         "--jq", ".[].tag_name"],
        capture_output=True, text=True,
    )
    if STABLE_TAG in result.stdout.splitlines():
        run(["gh", "release", "edit", STABLE_TAG, "--repo", RELEASES_REPO,
             "--notes", notes])
    else:
        run(["gh", "release", "create", STABLE_TAG, "--repo", RELEASES_REPO,
             "--title", "Folder-video — последняя версия", "--notes", notes,
             "--prerelease"])
    run(["gh", "release", "upload", STABLE_TAG, str(built),
         "--repo", RELEASES_REPO, "--clobber"])


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--version", help="Новая версия X.Y.Z; по умолчанию патч +1")
    parser.add_argument("--notes", default="", help="Описание релиза")
    parser.add_argument("--draft", action="store_true", help="Создать черновик без обновления latest")
    parser.add_argument("--dry-run", action="store_true", help="Собрать без коммита, тега, push и публикации")
    args = parser.parse_args(argv)

    if sys.platform != "win32" or platform.machine().lower() not in ("amd64", "x86_64"):
        raise RuntimeError("Этот скрипт собирает установщик на Windows x64")
    if not shutil.which("bun"):
        raise RuntimeError("Не найден bun в PATH")

    original = PACKAGE_JSON.read_bytes()
    current = json.loads(original.decode("utf-8-sig"))["version"]
    version = next_version(current, args.version)
    tag = f"{TAG_PREFIX}{version}"
    if not args.dry_run:
        preflight(tag)
    print(f"Версия: {current} → {version}", flush=True)

    asset = ROOT / "out" / "make" / f"folder-video-setup-{version}.exe"
    try:
        PACKAGE_JSON.write_bytes(with_version(original, version))
        built = build_installer()
        shutil.copy2(built, asset)
        print(f"Собрано: {asset}", flush=True)
    except BaseException:
        PACKAGE_JSON.write_bytes(original)
        raise

    if args.dry_run:
        PACKAGE_JSON.write_bytes(original)
        print("--dry-run: package.json восстановлен; коммит, тег, push и релиз пропущены.")
        return

    run(["git", "add", "--", "package.json"])
    run(["git", "commit", "-m", f"chore: релиз {tag}", "--only", "--", "package.json"])
    run(["git", "tag", tag])
    run(["git", "push", "origin", "HEAD"])
    run(["git", "push", "origin", tag])

    notes = args.notes or f"Folder-video {version}."
    command = ["gh", "release", "create", tag, str(asset), "--repo", RELEASES_REPO,
               "--title", f"Folder-video {version}", "--notes", notes]
    if args.draft:
        command.append("--draft")
    run(command)
    if not args.draft:
        publish_stable(built, version)
    print(f"Готово: https://github.com/{RELEASES_REPO}/releases/tag/{tag}")


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    try:
        main()
    except (RuntimeError, ValueError, OSError, subprocess.CalledProcessError) as error:
        sys.exit(f"Ошибка выпуска: {error}")
