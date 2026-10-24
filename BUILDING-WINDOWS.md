# Сборка и удаление приложения Windows

## Создать `.exe`

Выполнить из корня проекта:

```powershell
bun install
bun run make
```

После успешной сборки будут созданы два варианта приложения:

| Файл | Назначение |
| --- | --- |
| `out\folder-video-win32-x64\folder-video.exe` | Portable-версия. Запускать только из этой папки: переносить один `.exe` нельзя. |
| `out\make\squirrel.windows\x64\folder-video-setup.exe` | Установщик. Передать пользователю и запустить двойным щелчком. |

Проверить наличие установщика:

```powershell
Test-Path '.\out\make\squirrel.windows\x64\folder-video-setup.exe'
```

Ожидаемый результат — `True`.

## Выпустить новую версию

Скрипт [scripts/release.py](scripts/release.py) работает на Windows x64 с Python
3.11+ и установленными зависимостями проекта. Для публикации нужны `git`, `bun`
и GitHub CLI (`gh`) в `PATH`, вход через `gh auth login` и право записи в основной
репозиторий и `viktortat/utils-releases`. Если приложение запущено из `out`,
закройте его перед сборкой.

```powershell
python scripts/release.py --dry-run
python scripts/release.py --notes "Что нового"
python scripts/release.py --version 1.1.0 --notes "Что нового"
python scripts/release.py --draft
```

Вместо `python` можно использовать `uv run`. Без `--version` скрипт увеличивает
патч-версию на единицу. Явная версия должна быть больше текущей и иметь формат
`X.Y.Z` без ведущих нулей.

Обычный запуск требует чистого рабочего дерева и активной ветки Git. Скрипт
меняет только версию в `package.json`, выполняет `bun run make`, сохраняет
`out\make\folder-video-setup-<версия>.exe`, коммитит `package.json`, создаёт тег
`folder-video-v<версия>` и отправляет текущую ветку и тег в `origin`. Установщик
публикуется в `viktortat/utils-releases`, отдельно от исходников.

После публикации обновляется релиз `folder-video-latest` с постоянным именем
`folder-video-setup.exe`. Он помечается как prerelease, чтобы не занимать место
общего последнего релиза в репозитории нескольких приложений. Постоянная ссылка:
`https://github.com/viktortat/utils-releases/releases/download/folder-video-latest/folder-video-setup.exe`.
`--draft` создаёт черновик версии и не обновляет постоянную ссылку.

`--dry-run` допускает незакоммиченные изменения, собирает установщик с новой
версией, затем побайтно восстанавливает `package.json`. Git и GitHub не вызываются.
При ошибке сборки или копирования установщика исходный `package.json` также
восстанавливается. После начала коммита и публикации автоматического отката нет:
при ошибке проверьте ветку, тег и релиз перед повторным запуском.

Проверить логику скрипта без сборки и публикации:

```powershell
python -m unittest discover -s scripts -p test_release.py
```

## Установить

```powershell
Start-Process '.\out\make\squirrel.windows\x64\folder-video-setup.exe'
```

После установки ярлыки появляются в меню «Пуск» и на рабочем столе.

Если плитка Folder-video в меню «Пуск» отображается пустым листом после
обновления, открепите её от «Пуска», затем найдите Folder-video в списке
приложений и закрепите заново. Windows хранит изображение плитки отдельно от
значка исполняемого файла.

## Удалить приложение

Через Windows: «Параметры» → «Приложения» → «Установленные приложения» → `folder-video` → «Удалить».

Или через PowerShell:

```powershell
& "$env:LOCALAPPDATA\folder_video\Update.exe" --uninstall
```

Команда удаляет приложение и ярлыки. Настройки пользователя могут остаться в
`%APPDATA%\folder-video`.

## Очистить сборки и зависимости

Из Git Bash выполните `./clear.sh` или `bash clear.sh`. Скрипт удаляет
`node_modules`, `out`, `out-*`, `dist`, `dist-electron` и `.bun-tmp` рядом с собой,
независимо от текущей папки терминала. Символические ссылки удаляются без обхода
их содержимого. Перед очисткой закройте приложение, запущенное из `out`.

Для следующей сборки сначала восстановите зависимости:

```powershell
bun install
bun run make
```

## Если `bun run make` завершился с ошибкой

Не передавать файлы из `out/`, пока команда не завершилась успешно и проверка
`Test-Path` не вернула `True`.

## Источники

- [Electron Forge: Makers](https://www.electronforge.io/config/makers)
- [Electron: Packaging Your Application](https://www.electronjs.org/docs/latest/tutorial/tutorial-5-packaging)
