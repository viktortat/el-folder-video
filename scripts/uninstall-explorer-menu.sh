#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v powershell.exe >/dev/null 2>&1; then
  echo "Не найден powershell.exe. Скрипт предназначен для Git Bash или WSL в Windows." >&2
  exit 1
fi

if command -v cygpath >/dev/null 2>&1; then
  SCRIPT_PATH="$(cygpath -w "$SCRIPT_DIR/uninstall-explorer-menu.ps1")"
else
  SCRIPT_PATH="$(wslpath -w "$SCRIPT_DIR/uninstall-explorer-menu.ps1")"
fi
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$SCRIPT_PATH"
