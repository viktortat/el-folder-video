# Инструкции для агентов: Folder-video

## Назначение

`Folder-video` — локальное Electron-приложение для просмотра видео из папки. Техническое имя пакета — `folder-video`; базовый заголовок окна — `Folder-video-vik`.

Рабочая папка проекта — корень репозитория. Версия пакета и доступные команды находятся в `package.json`; не копировать команды из старых проектов или внешних инструкций.

## Стек и границы процессов

- Electron Forge, Electron 30, vanilla HTML/CSS/JavaScript.
- Пакетный менеджер и запуск скриптов — Bun; зависимости фиксируются в `bun.lock`.
- `better-sqlite3` используется для SQLite-метаданных, `marked` — для Markdown-предпросмотра.
- `main.js` — единственное место для Node.js API, файловой системы, Electron `shell` и нативных диалогов.
- `preload.js` — единственный мост между renderer и main через `contextBridge`.
- `app.js` и `app.css` работают в renderer без Node.js.
- Не включать `nodeIntegration`, не отключать `contextIsolation` и sandbox.
- Не импортировать Node.js или Electron API напрямую в `app.js`.

## Правила доработок

- Сохранять работу в одном окне и модель пользовательских вкладок приложения.
- Любую новую возможность, требующую доступа к ОС или файлам, добавлять цепочкой: `main.js` IPC handler → `preload.js` API → `app.js`.
- Не жёстко кодировать пути к внешним приложениям. Для открытия файла в системной программе использовать `shell.openPath()`.
- Не добавлять дисковый кэш миниатюр без отдельного требования. Кэш кадров должен оставаться в памяти.
- При смене папки освобождать object URL и очищать кэш и вкладки, относящиеся к прежней папке.
- Не обходить символические ссылки при сканировании. Ошибки доступа к папкам не должны останавливать сканирование остальных файлов.
- Поддерживать обе темы: любые новые элементы обязаны иметь корректные dark и `body.light` состояния.
- Не ухудшать доступность: интерактивным элементам задавать `title` и `aria-label`, когда назначение не очевидно из текста.
- Для ускорения видео использовать системный `ffmpeg`, вызываемый по имени из `PATH`; не встраивать жёстко заданные пути к бинарнику.
- Поддерживаемые расширения должны оставаться согласованными между `app.js`, IPC и скриптами интеграции с Проводником: `mp4`, `webm`, `mov`, `avi`, `mkv`, `m4v`, `ogv`.

## Пакетный менеджер

- Использовать только Bun для запуска скриптов: `bun run <script>`.
- `npm` и `npx` в этом проекте не использовать.
- Не редактировать `package-lock.json` вручную и не использовать его как источник команд; основной lock-файл проекта — `bun.lock`.
- Нативные SQLite-тесты запускаются через `bun run test`, который вызывает Node test runner: Bun пока не поддерживает `better-sqlite3` напрямую.

## Проверка изменений

Перед передачей результата выполнить из этой папки:

```powershell
node --check main.js
node --check preload.js
node --check app.js
bun run test
git diff --check
```

Для документационных правок достаточно этих проверок. Изменения в runtime-коде нужно дополнительно проверять по затронутому сценарию; при изменениях поставки — собрать пакет.

После изменений, влияющих на поставку, выполнить:

```powershell
bun run package
```

Portable-сборка создаётся в `out\folder-video-win32-x64\folder-video.exe`. Не пытаться собирать, пока запущенное приложение удерживает файлы в `out`.

## Документация

- При изменении поведения обновлять `README.md` и, если изменились требования, `folder-video-prd.md`.
- Подробные команды сборки и установки находятся в `BUILDING-WINDOWS.md`.
- Инструкции по macOS находятся в `BUILDING-MACOS.md`; DMG собирается только на macOS.
- `EXPLORER-MENU.md` описывает интеграцию с контекстным меню Windows, а скрипты для неё находятся в `scripts/`.

## Known Issues

### PowerShell inline Python quoting

When running `python -c "..."` in PowerShell, quotes and braces inside the string
get eaten by PowerShell before Python sees them.
This causes `ParserError: Missing argument in parameter list`.

Use PowerShell-native instead of `python -c` for simple file edits:

```powershell
$c = Get-Content file.js -Encoding UTF8 -Raw
$c = $c.Replace("old", "new")
Set-Content file.js -Encoding UTF8 -Value $c
```

Or write a Python script to a separate file and execute it.

### PowerShell .Replace() in single quotes

In single-quoted strings `'...'`, backslash before a quote is a
literal backslash, not an escape. A `.Replace('"old"', '"new"')`
will NOT match text with plain double quotes.

Solutions:
- Use `[System.IO.File]::ReadAllText / WriteAllText` with .NET to avoid quoting issues
- Or double-quoted strings with backtick-escaping: `$c.Replace(`"old`", `"new`")`
