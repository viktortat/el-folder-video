# Folder-video: техническая документация

## Назначение

Folder-video - Electron-приложение для просмотра локальных видеопапок. Главное окно показывает ленты миниатюр, а ролики открываются во вкладках с плеером, сеткой кадров и редактируемыми метаданными.

Приложение поддерживает `mp4`, `webm`, `mov`, `avi`, `mkv`, `m4v` и `ogv`. Сканер может обходить вложенные папки, пропускает символические ссылки и продолжает работу при ошибках доступа к отдельным каталогам.

## Требования

- Bun для установки зависимостей и запуска скриптов.
- Node.js для синтаксических проверок и `node --test`.
- Windows 10 или 11 для полного набора функций и Windows-сборки.
- FFmpeg в `PATH`, только если нужна команда ускорения ролика.

macOS-сборка описана в [BUILDING-MACOS.md](BUILDING-MACOS.md).

## Установка и запуск из исходников

```powershell
bun install
bun run start
```

Проект использует Electron Forge, Electron 30, vanilla HTML, CSS и JavaScript. Не используйте `npm` или `npx` для скриптов проекта.

## Данные и конфигурация

Основной `config.json` находится в каталоге данных Electron. По умолчанию метаданные хранятся в `Documents/folder-video-metadata`: один JSON-файл на видео, имя которого построено из полного SHA-256, и `template.html` для панели метаданных.

В настройках можно изменить каталог метаданных и URL Git-репозитория. Синхронизация выполняет `pull --rebase`, затем при наличии изменений создаёт коммит и выполняет `push`.

Локальные предпочтения интерфейса, избранное и последние папки сохраняются отдельно. Миниатюры и кадры держатся в памяти и очищаются при смене папки или закрытии приложения.

## Устройство проекта

| Путь | Роль |
| --- | --- |
| `src/main/main.js` | Окно Electron, файловая система, IPC, метаданные, Git, FFmpeg и нативные диалоги. |
| `src/main/*.js` | Модули main-процесса: метаданные (`video-metadata-store.js`), SHA-256 (`hash-file.js`), вырезка (`cut-ffmpeg.js`, `cut-undo.js`), обновления, сводки, YouTube-ссылки. |
| `src/preload/preload.js` | Ограниченный API `window.folderVideo` для renderer-процесса. |
| `src/renderer/` | `index.html`, `app.js`, `app.css` — интерфейс без Node.js; `lib/` — очередь миниатюр и сессия вкладок. |
| `src/shared/` | Чистые модули без Node.js API, общие для main и renderer: `cut-core.js`, `notes-core.js`, `waveform-core.js`. |
| `tests/` | Тесты Node test runner; структура повторяет `src/`. |
| `scripts/`, `tools/`, `assets/` | Скрипты разработки и интеграции, нативные библиотеки распознавания, иконки. |

Node.js API и Electron API находятся только в `src/main/` и `src/preload/preload.js`. В renderer отключён `nodeIntegration`; включены `contextIsolation` и sandbox.

## Проверки

```powershell
node --check src/main/main.js
node --check src/preload/preload.js
node --check src/renderer/app.js
bun run test
git diff --check
```

`bun run test` запускает Node test runner для всех файлов `tests/**/*.test.js`.

## Упаковка

Для portable-сборки:

```powershell
bun run package
```

Результат: `out\\folder-video-win32-x64\\folder-video.exe`.

Для установщика Windows:

```powershell
bun run make
```

Подробности: [BUILDING-WINDOWS.md](BUILDING-WINDOWS.md). Интеграция с Проводником описана в [EXPLORER-MENU.md](EXPLORER-MENU.md).

## Ограничения и безопасность

Приложение работает с локальными файлами. Удаление отправляет файл в корзину Windows только после подтверждения. Воспроизведение зависит от поддержки кодека Chromium, поэтому файл с подходящим расширением может не открыться.

FFmpeg вызывается по имени из `PATH`; путь к бинарнику не зашит в код. Ссылка на метаданные строится по содержимому файла, поэтому абсолютный путь исходного видео в JSON не хранится.

[Пользовательская документация](../README.ru.md)
