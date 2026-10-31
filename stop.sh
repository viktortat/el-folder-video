#!/usr/bin/env bash
# ./stop.sh — остановка Folder-video, запущенного через start.sh.
set -euo pipefail

cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")"
case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) ;;
    *) echo 'Скрипт рассчитан на Git Bash в Windows.' >&2; exit 1 ;;
esac

for option in "$@"; do
    case "$option" in
        -h|--help)
            echo './stop.sh   остановить Folder-video, запущенный start.sh (вместе с дочерними процессами)'
            exit 0 ;;
        *) echo "Неизвестный параметр: $option" >&2; exit 2 ;;
    esac
done

export FV_LAUNCH_ROOT="$(pwd -W)"
powershell.exe -NoProfile -NonInteractive -Command "$(cat <<'POWERSHELL'
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try {
    $root = $env:FV_LAUNCH_ROOT
    $stateFile = Join-Path $root '.run/dev-sh.json'
    if (-not (Test-Path -LiteralPath $stateFile)) {
        Write-Output 'Нет экземпляра Folder-video, запущенного start.sh.'
        exit 0
    }
    $saved = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    if ($saved.project -ne $root -or $null -eq $saved.processes) {
        throw "Некорректный файл состояния: $stateFile"
    }
    foreach ($entry in @($saved.processes)) {
        if ($entry.pid -isnot [int] -or $entry.pid -le 0 -or [string]$entry.created -notmatch '^\d+$') {
            throw "Некорректный файл состояния: $stateFile"
        }
    }
    foreach ($entry in @($saved.processes)) {
        $existing = Get-Process -Id $entry.pid -ErrorAction SilentlyContinue
        # Сверяем время старта, чтобы не убить чужой процесс с переиспользованным PID.
        if (-not $existing -or [string]$existing.StartTime.ToUniversalTime().Ticks -ne [string]$entry.created) {
            Write-Output "$($entry.name): уже остановлен."
            continue
        }
        & taskkill.exe /PID $entry.pid /T /F | Out-Null
        if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $entry.pid -ErrorAction SilentlyContinue)) {
            throw "Не удалось остановить $($entry.name)."
        }
        Write-Output "$($entry.name): остановлен."
    }
    Remove-Item -LiteralPath $stateFile
    Write-Output 'Folder-video остановлен.'
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
POWERSHELL
)"
