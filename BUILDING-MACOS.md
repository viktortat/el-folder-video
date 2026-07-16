# Сборка Folder-video для macOS

## Что потребуется

- Компьютер с macOS. DMG необходимо собирать непосредственно на macOS.
- Bun.
- Для релизной подписи и notarization: Xcode и учётная запись Apple Developer.

## Получить исходный код и зависимости

```bash
git clone <URL-репозитория>
cd karpaty-db-electron/demo-vik2
bun install
```

## Запуск в разработке

```bash
bun run start
```

## Создать приложение без установочного образа

```bash
bun run package:mac
```

Результат — пакет `.app` в каталоге `out/`.

## Создать DMG и ZIP

```bash
bun run make:mac
```

Electron Forge создаст:

- `.dmg` — образ для установки приложения перетаскиванием в `/Applications`;
- `.zip` — архив с `.app`, который пригодится для распространения или автообновлений.

Артефакты находятся в `out/make/`.

## Apple Silicon и Intel

Команды выше собирают приложение под архитектуру текущего Mac. Для Apple Silicon используйте `--arch=arm64`, для Intel — `--arch=x64`:

```bash
npx electron-forge make --platform=darwin --arch=arm64
npx electron-forge make --platform=darwin --arch=x64
```

## Подпись и notarization перед распространением

Неподписанное приложение можно открыть на своём Mac, но для передачи другим пользователям macOS будет показывать предупреждения Gatekeeper. Для публичного распространения нужны:

1. Участие в Apple Developer Program.
2. Установленные в Keychain сертификаты Developer ID.
3. Xcode и учётные данные notarization.
4. Настройка `osxSign` и `osxNotarize` в `forge.config.js` без сохранения секретов в репозитории.

Секреты передавайте через переменные окружения или secrets CI. Не записывайте Apple ID, app-specific password, API keys или сертификаты в `forge.config.js`.

## Проверка результата

```bash
open out/make
```

Откройте собранный DMG, перетащите `Folder-video` в `/Applications`, затем запустите приложение и проверьте выбор папки, воспроизведение видео и открытие файла во внешнем системном плеере.

## Официальные источники

- [Electron Forge: DMG maker](https://www.electronforge.io/config/makers/dmg)
- [Electron Forge: makers](https://www.electronforge.io/config/makers)
- [Electron: code signing и notarization](https://www.electronjs.org/docs/latest/tutorial/code-signing)
