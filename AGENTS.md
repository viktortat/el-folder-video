# Инструкции для агентов: Folder-video

## Назначение

`Folder-video` — локальное Electron-приложение для просмотра видео из папки. Техническое имя пакета — `folder-video`; базовый заголовок окна — `Folder-video-vik`.

Рабочая папка проекта — корень репозитория. Версия пакета и доступные команды находятся в `package.json`; не копировать команды из старых проектов или внешних инструкций.

## Стек и границы процессов

- Electron Forge, Electron 30, vanilla HTML/CSS/JavaScript.
- Пакетный менеджер и запуск скриптов — Bun; зависимости фиксируются в `bun.lock`.
- Метаданные видео хранятся в JSON-файлах по SHA-256 содержимого (`src/main/video-metadata-store.js`); `marked` — для Markdown-предпросмотра. В `package.json` `better-sqlite3` нет.
- `src/main/main.js` — единственное место для Node.js API, файловой системы, Electron `shell` и нативных диалогов.
- `src/preload/preload.js` — единственный мост между renderer и main через `contextBridge`.
- `src/renderer/` (`app.js`, `app.css`, `index.html`, `lib/`) работает в renderer без Node.js. `src/shared/` — чистые модули без Node.js API, загружаемые и в main через `require`, и в renderer через `<script>`.
- Не включать `nodeIntegration`, не отключать `contextIsolation` и sandbox.
- Не импортировать Node.js или Electron API напрямую в `src/renderer/app.js`.

## Правила доработок

- Сохранять работу в одном окне и модель пользовательских вкладок приложения.
- Любую новую возможность, требующую доступа к ОС или файлам, добавлять цепочкой: `src/main/main.js` IPC handler → `src/preload/preload.js` API → `src/renderer/app.js`.
- Не жёстко кодировать пути к внешним приложениям. Для открытия файла в системной программе использовать `shell.openPath()`.
- Не добавлять дисковый кэш миниатюр без отдельного требования. Кэш кадров должен оставаться в памяти.
- При смене папки освобождать object URL и очищать кэш и вкладки, относящиеся к прежней папке.
- Не обходить символические ссылки при сканировании. Ошибки доступа к папкам не должны останавливать сканирование остальных файлов.
- Поддерживать обе темы: любые новые элементы обязаны иметь корректные dark и `body.light` состояния.
- Не ухудшать доступность: интерактивным элементам задавать `title` и `aria-label`, когда назначение не очевидно из текста.
- Для ускорения видео использовать системный `ffmpeg`, вызываемый по имени из `PATH`; не встраивать жёстко заданные пути к бинарнику.
- Вырезка фрагментов: логика диапазонов и аргументов ffmpeg — в `src/shared/cut-core.js` (без Node.js API), запуск ffmpeg/ffprobe — в `src/main/cut-ffmpeg.js`, бэкапы и откат — в `src/main/cut-undo.js`. Оригинал при замене уходит в `.fv-undo` рядом с видео, а не в корзину; сканер этот каталог пропускает. `ffprobe` вызывается по имени из `PATH`.
- Поддерживаемые расширения должны оставаться согласованными между `src/renderer/app.js`, IPC и скриптами интеграции с Проводником: `mp4`, `webm`, `mov`, `avi`, `mkv`, `m4v`, `ogv`.

## Пакетный менеджер

- Использовать только Bun для запуска скриптов: `bun run <script>`.
- `npm` и `npx` в этом проекте не использовать.
- Не редактировать `package-lock.json` вручную и не использовать его как источник команд; основной lock-файл проекта — `bun.lock`.
- Нативные SQLite-тесты запускаются через `bun run test`, который вызывает Node test runner: Bun пока не поддерживает `better-sqlite3` напрямую.

## Проверка изменений

Перед передачей результата выполнить из этой папки:

```powershell
node --check src/main/main.js
node --check src/preload/preload.js
node --check src/renderer/app.js
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

- При изменении поведения обновлять `README.md` и, если изменились требования, `docs/folder-video-prd.md`.
- Подробные команды сборки и установки находятся в `docs/BUILDING-WINDOWS.md`.
- Инструкции по macOS находятся в `docs/BUILDING-MACOS.md`; DMG собирается только на macOS.
- `docs/EXPLORER-MENU.md` описывает интеграцию с контекстным меню Windows, а скрипты для неё находятся в `scripts/`.

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

### Скриптовые правки файлов на Windows

- `python3` в `PATH` — заглушка Microsoft Store: печатает «Python» и ничего не выполняет, без ошибки. Использовать `python`.
- Исходники проекта (`*.js`, `*.css`, `*.md`) хранятся с окончаниями CRLF. В Python читать файл через `open(p, encoding='utf8').read()`, искать и заменять фрагменты с `\n`, писать через `open(p, 'w', encoding='utf8', newline='\r\n')`. Иначе многострочные замены не находятся или окончания строк переписываются целиком.
- Длинные heredoc с русским текстом, кавычками и обратными апострофами ломаются в Bash («unexpected EOF»). Для точечных правок использовать `Edit`; для массовых — записать скрипт в файл и запустить `python <файл>`.
- В скрипте проверять каждую замену (`assert old in s`), а после запуска — `grep` по результату и `node --check`: нельзя считать правку применённой, пока это не проверено.
- Что работает надёжно: для правки кода с регэкспами, обратными слэшами и кавычками использовать инструмент `Edit` (точная замена строки, без слоя экранирования). Не вставлять код с обратными слэшами и регэкспами в обычные Python-строки скрипта: Python съедает экранирование (`\\` становится `\`, а `\/` остаётся `\/`), и в файл попадает искажённый код (так терялся слэш в регэкспе `/[\\/]+$/`).
- Если правку всё же нужно сделать скриптом, исходный фрагмент класть в raw-строку `r'''...'''` либо читать из отдельного файла-патча, а не писать литералом с обратными слэшами. После правки обязательно вывести изменённую строку (`sed -n <N>p` или `grep -n`) и сверить её с задуманной, затем `node --check`.
- Порядок выбора: одна-две точечные правки — `Edit`; много однотипных замен — скрипт `python <файл>` с raw-строками и `assert`; вставка многострочного текста с кавычками — `Edit`/`Write`, а не heredoc.
