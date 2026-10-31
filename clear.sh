#!/usr/bin/env bash
# ./clear.sh
set -euo pipefail

usage() {
    cat <<'HELP'
Очистка проекта Folder-video (Git Bash, Windows).

  ./clear.sh             удалить кэши, зависимости и результаты сборки
  ./clear.sh --dry-run   показать папки без удаления

Исходники, .git и bun.lock сохраняются.
После очистки start.sh заново установит зависимости (bun install).
HELP
}

dry_run=0
for option in "$@"; do
    case "$option" in
        --dry-run) dry_run=1 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Неизвестный параметр: $option" >&2; usage >&2; exit 2 ;;
    esac
done

case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) ;;
    *) echo 'Скрипт рассчитан на Git Bash в Windows.' >&2; exit 1 ;;
esac

cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")"
export FV_CLEAR_ROOT="$(pwd -W)"
export FV_CLEAR_DRY_RUN="$dry_run"

powershell.exe -NoProfile -NonInteractive -Command "$(cat <<'POWERSHELL'
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try {
    $root = [IO.Path]::GetFullPath($env:FV_CLEAR_ROOT).TrimEnd('\', '/')
    $prefix = $root + [IO.Path]::DirectorySeparatorChar
    if ($root -eq [IO.Path]::GetPathRoot($root).TrimEnd('\', '/')) {
        throw 'Нельзя очищать корень диска.'
    }
    $package = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
    if ($package.name -ne 'folder-video' -or -not (Test-Path -LiteralPath (Join-Path $root 'forge.config.js'))) {
        throw 'Не найден корень проекта Folder-video.'
    }
    if ((Get-Item -LiteralPath $root -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'Корень проекта не должен быть ссылкой или junction.'
    }
    $dryRun = $env:FV_CLEAR_DRY_RUN -eq '1'

    # Сборки, временные файлы Bun и зависимости.
    $paths = @('.run', 'node_modules', 'out', 'dist', 'dist-electron', '.bun-tmp', 'scripts/__pycache__')
    foreach ($extra in Get-ChildItem -LiteralPath $root -Directory -Force -Filter 'out-*') {
        $paths += $extra.Name
    }

    # Проверяем все абсолютные пути до первого удаления.
    $targets = @()
    foreach ($relative in $paths) {
        $target = [IO.Path]::GetFullPath((Join-Path $root $relative))
        if (-not $target.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Путь выходит за пределы проекта: $target"
        }
        if (Test-Path -LiteralPath $target) { $targets += $target }
    }

    if (-not $dryRun) {
        $state = Join-Path $root '.run/dev-sh.json'
        if (Test-Path -LiteralPath $state) {
            $saved = Get-Content -LiteralPath $state -Raw | ConvertFrom-Json
            foreach ($entry in @($saved.processes)) {
                if ($entry.pid -isnot [int] -or $entry.pid -le 0 -or [string]$entry.created -notmatch '^\d+$') {
                    throw "Некорректный файл состояния: $state"
                }
                $process = Get-Process -Id $entry.pid -ErrorAction SilentlyContinue
                if ($process -and [string]$process.StartTime.ToUniversalTime().Ticks -eq [string]$entry.created) {
                    throw 'Приложение запущено. Выполните ./stop.sh перед очисткой.'
                }
            }
        }
        $names = @('bun.exe', 'node.exe', 'electron.exe', 'folder-video.exe')
        $busy = @(Get-CimInstance Win32_Process | Where-Object {
            $exe = [string]$_.ExecutablePath
            $cmd = ([string]$_.CommandLine).Replace('/', '\')
            $_.Name -in $names -and ($exe.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or
                $cmd.IndexOf($prefix, [StringComparison]::OrdinalIgnoreCase) -ge 0)
        })
        if ($busy.Count -gt 0) {
            throw ('Процессы проекта работают: ' + (($busy | ForEach-Object { "$($_.Name) (PID $($_.ProcessId))" }) -join ', ') + '. Закройте приложение и сборку перед очисткой.')
        }
    }

    function Remove-GeneratedItem([string]$path) {
        $item = Get-Item -LiteralPath $path -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            # Удаляем саму ссылку, не заходим в её целевой каталог.
            if ($item.PSIsContainer) { [IO.Directory]::Delete($item.FullName) }
            else { [IO.File]::Delete($item.FullName) }
        } elseif ($item.PSIsContainer) {
            foreach ($child in Get-ChildItem -LiteralPath $item.FullName -Force) {
                Remove-GeneratedItem $child.FullName
            }
            Remove-Item -LiteralPath $item.FullName -Force
        } else {
            Remove-Item -LiteralPath $item.FullName -Force
        }
    }

    foreach ($target in $targets) {
        if ($dryRun) { Write-Output "Будет удалено: $target" }
        else { Remove-GeneratedItem $target; Write-Output "Удалено: $target" }
    }
    if ($dryRun) { Write-Output 'Просмотр завершён. Ничего не удалено.' }
    else { Write-Output 'Очистка файлов завершена.' }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
POWERSHELL
)"

if [[ $dry_run -eq 0 ]]; then
    echo 'Для запуска: ./start.sh'
fi
