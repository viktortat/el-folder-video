#!/usr/bin/env bash
# ./clear.sh
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd -- "$project_root"

# Сборки, временные файлы Bun и зависимости.
for path in node_modules out out-* dist dist-electron .bun-tmp; do
  if [[ -L $path ]]; then
    # Удаляем саму ссылку, не переходя к её содержимому.
    rm -f -- "$project_root/$path"
  elif [[ -d $path ]]; then
    target="$(cd -- "$path" && pwd -P)"
    case "$target" in
      "$project_root"/*) rm -rf -- "$target" ;;
      *) printf 'Отказ: каталог вне проекта: %s\n' "$target" >&2; exit 1 ;;
    esac
  elif [[ -e $path ]]; then
    rm -f -- "$project_root/$path"
  fi
done
