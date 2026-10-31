#!/usr/bin/env bash
# ./start.sh — запуск Folder-video в режиме разработки (electron-forge start).
set -euo pipefail

cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")"
case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) ;;
    *) echo 'Скрипт рассчитан на Git Bash в Windows.' >&2; exit 1 ;;
esac

for tool in bun powershell.exe; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "Не найден $tool в PATH." >&2
        exit 1
    fi
done

if [[ ! -d node_modules/electron ]]; then
    echo 'Устанавливаю зависимости Bun…'
    bun install --frozen-lockfile
fi

export FV_LAUNCH_ROOT="$(pwd -W)"
export FV_LAUNCH_BUN="$(cygpath -w "$(command -v bun)")"
powershell.exe -NoProfile -NonInteractive -Command "$(cat <<'POWERSHELL'
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try {
    $root = $env:FV_LAUNCH_ROOT
    $runDir = Join-Path $root '.run'
    $stateFile = Join-Path $runDir 'dev-sh.json'
    New-Item -ItemType Directory -Path $runDir -Force | Out-Null

    function Test-Saved($entry) {
        if ($entry.pid -isnot [int] -or $entry.pid -le 0 -or [string]$entry.created -notmatch '^\d+$') {
            return $false
        }
        $p = Get-Process -Id $entry.pid -ErrorAction SilentlyContinue
        return [bool]($p -and [string]$p.StartTime.ToUniversalTime().Ticks -eq [string]$entry.created)
    }

    if (Test-Path -LiteralPath $stateFile) {
        $saved = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
        if ($saved.project -ne $root -or $null -eq $saved.processes) {
            throw "Некорректный файл состояния: $stateFile"
        }
        if (@($saved.processes | Where-Object { Test-Saved $_ }).Count -gt 0) {
            Write-Output 'Folder-video уже запущен. Остановить: ./stop.sh'
            exit 0
        }
        Remove-Item -LiteralPath $stateFile
    }

    $log = Join-Path $runDir 'app.log'
    $errorLog = Join-Path $runDir 'app-error.log'
    Write-Output 'Запускаю Folder-video…'
    # Окно Electron создаёт само приложение; скрываем только консоль bun.
    $child = Start-Process -FilePath $env:FV_LAUNCH_BUN -ArgumentList @('run', 'start') `
        -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $log `
        -RedirectStandardError $errorLog -PassThru
    $started = @(@{ name = 'app'; pid = $child.Id
                    created = [string]$child.StartTime.ToUniversalTime().Ticks })
    @{ project = $root; processes = $started } | ConvertTo-Json -Depth 4 |
        Set-Content -LiteralPath $stateFile -Encoding UTF8

    Start-Sleep -Seconds 5
    if (-not (Test-Saved $started[0])) {
        Remove-Item -LiteralPath $stateFile
        throw "Процесс завершился. Логи: $log; $errorLog"
    }
    Write-Output 'Запущено. Логи: .run/*.log'
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
POWERSHELL
)"
