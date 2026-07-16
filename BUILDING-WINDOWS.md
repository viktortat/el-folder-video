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

## Установить

```powershell
Start-Process '.\out\make\squirrel.windows\x64\folder-video-setup.exe'
```

После установки ярлыки появляются в меню «Пуск» и на рабочем столе.

## Удалить приложение

Через Windows: «Параметры» → «Приложения» → «Установленные приложения» → `folder-video` → «Удалить».

Или через PowerShell:

```powershell
& "$env:LOCALAPPDATA\folder_video\Update.exe" --uninstall
```

Команда удаляет приложение и ярлыки. Настройки пользователя могут остаться в
`%APPDATA%\folder-video`.

## Если `bun run make` завершился с ошибкой

Не передавать файлы из `out/`, пока команда не завершилась успешно и проверка
`Test-Path` не вернула `True`.

## Источники

- [Electron Forge: Makers](https://www.electronforge.io/config/makers)
- [Electron: Packaging Your Application](https://www.electronjs.org/docs/latest/tutorial/tutorial-5-packaging)
