#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_PATH="${1:-}"

if ! command -v powershell.exe >/dev/null 2>&1; then
  echo "Не найден powershell.exe. Скрипт предназначен для Git Bash или WSL в Windows." >&2
  exit 1
fi

to_windows_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else wslpath -w "$1"; fi
}

if [[ -n "$APP_PATH" ]]; then
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(to_windows_path "$SCRIPT_DIR/install-explorer-menu.ps1")" -AppPath "$(to_windows_path "$APP_PATH")"
else
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(to_windows_path "$SCRIPT_DIR/install-explorer-menu.ps1")"
fi
