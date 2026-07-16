# Контекстное меню Проводника Windows

Скрипты добавляют в контекстное меню Windows пункты для запуска Folder-video:

- на папке — «Open in Folder-video»;
- на видео `mp4`, `webm`, `mov`, `avi`, `mkv`, `m4v`, `ogv` — «Open video in Folder-video».

При открытии видео приложение загружает его папку и сразу открывает выбранный ролик во вкладке.

## Установка

1. Соберите portable-версию приложения:

   ```powershell
   cd E:\_Projects3\18\karpaty-db-electron\demo-vik2
   bun run package
   ```

2. Выполните скрипт установки:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\install-explorer-menu.ps1
   ```

   Из Git Bash или WSL можно использовать обёртку:

   ```bash
   ./scripts/install-explorer-menu.sh
   ```

Скрипт меняет только раздел реестра текущего пользователя (`HKCU`), поэтому права администратора не требуются.

Если `folder-video.exe` находится в другом месте, передайте его путь явно:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-explorer-menu.ps1 -AppPath 'D:\Apps\Folder-video\folder-video.exe'
```

После установки щёлкните правой кнопкой по папке или поддерживаемому видео. В Windows 11 пункт может находиться в меню «Показать дополнительные параметры».

## Удаление

Выполните:

```powershell
cd E:\_Projects3\18\karpaty-db-electron\demo-vik2
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-explorer-menu.ps1
```

Из Git Bash или WSL:

```bash
./scripts/uninstall-explorer-menu.sh
```

Скрипт удаляет только пункты `FolderVideo`, созданные скриптом установки; настройки Folder-video и сами видео не затрагиваются.

## Если приложение перенесли

Повторно выполните `install-explorer-menu.ps1`, передав новый путь через `-AppPath`. Это обновит команду меню без предварительного удаления старой записи.
