const { app, BrowserWindow, dialog, ipcMain, shell, nativeImage, Menu, clipboard } = require('electron');
const { readdir, lstat, rename, copyFile, unlink, readFile, writeFile, mkdir, rm } = require('node:fs/promises');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { VideoMetadataStore } = require('./video-metadata-store');
const { hashFile } = require('./hash-file');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v', '.ogv']);
const BASE_TITLE = 'Folder-video-vik';
const APP_VERSION = app.getVersion();
const APP_TITLE = `${BASE_TITLE} v${APP_VERSION}`;
const DEFAULT_METADATA_TEMPLATE = `<form id="metadataForm">
  <style>.metadata-template-title{margin:0 0 12px;color:#c9b6ff;font:700 15px Manrope,sans-serif}</style>
  <p class="metadata-template-title">{{title}}</p>
  <p class="metadata-hash" title="SHA-256">{{contentHashShort}}</p>
  <label class="metadata-label">Название<input id="metadataTitle" value="{{title}}" /></label>
  <label class="metadata-label">YouTube<div class="metadata-input-row"><input id="metadataYoutube" type="url" value="{{youtubeUrl}}" placeholder="https://youtube.com/..." /><button id="openYoutube" type="button" title="Открыть YouTube" aria-label="Открыть YouTube">↗</button></div></label>
  <label class="metadata-label">Obsidian<div class="metadata-input-row"><input id="metadataObsidian" type="url" value="{{obsidianUrl}}" placeholder="obsidian://open/..." /><button id="openObsidian" type="button" title="Открыть в Obsidian" aria-label="Открыть в Obsidian">↗</button></div></label>
  <label class="metadata-label">Папка проекта<div class="metadata-input-row"><input id="metadataProjectFolder" value="{{projectFolder}}" /><button id="openProjectFolder" type="button" title="Открыть папку проекта" aria-label="Открыть папку проекта">↗</button></div></label>
  <div class="metadata-section-head"><span>Описание</span><div class="metadata-mode"><button type="button" data-mode="edit" class="{{editClass}}">Edit</button><button type="button" data-mode="preview" class="{{previewClass}}">Preview</button></div></div>{{descriptionMarkup}}
  <label class="metadata-label">Теги<div id="metadataTags" class="metadata-tags"></div></label>
  <footer class="metadata-footer"><span id="metadataState">{{saveState}}</span><button class="metadata-save" type="submit">Сохранить</button></footer>
</form>`;
let metadataStore;
const metadataJobs = new Map();
let pendingLaunchTarget = null;
let isRendererReady = false;
let appSettings;
let hasSettingsFile = false;

function defaultSettings() {
  return {
    version: 1,
    theme: 'dark',
    storage: { metadataDirectory: path.join(app.getPath('documents'), 'folder-video-metadata'), gitRepositoryUrl: '' },
    viewer: { columns: 3, seconds: 10, scroll: 'center' },
    interface: { metadataCollapsed: false, gridCollapsed: false }
  };
}

function normalizeSettings(value) {
  const defaults = defaultSettings();
  const source = value && typeof value === 'object' ? value : {};
  const columns = [3, 4, 5, 6, 8].includes(source.viewer?.columns) ? source.viewer.columns : defaults.viewer.columns;
  const seconds = [5, 10, 15, 30, 60].includes(source.viewer?.seconds) ? source.viewer.seconds : defaults.viewer.seconds;
  const scroll = ['center', 'edge', 'off'].includes(source.viewer?.scroll) ? source.viewer.scroll : defaults.viewer.scroll;
  const metadataDirectory = typeof source.storage?.metadataDirectory === 'string' && source.storage.metadataDirectory.trim()
    ? path.resolve(source.storage.metadataDirectory) : defaults.storage.metadataDirectory;
  const gitRepositoryUrl = typeof source.storage?.gitRepositoryUrl === 'string' ? source.storage.gitRepositoryUrl.trim() : '';
  return {
    version: 1,
    theme: source.theme === 'light' ? 'light' : 'dark',
    storage: { metadataDirectory, gitRepositoryUrl }, viewer: { columns, seconds, scroll },
    interface: { metadataCollapsed: source.interface?.metadataCollapsed === true, gridCollapsed: source.interface?.gridCollapsed === true }
  };
}

function settingsPath() { return path.join(app.getPath('userData'), 'config.json'); }

async function loadSettings() {
  try {
    const value = JSON.parse(await readFile(settingsPath(), 'utf8'));
    appSettings = normalizeSettings(value);
    hasSettingsFile = true;
    return { settings: appSettings };
  } catch (error) {
    appSettings = defaultSettings();
    hasSettingsFile = false;
    return { settings: appSettings, warning: error.code === 'ENOENT' ? null : 'Не удалось прочитать config.json; использованы настройки по умолчанию.' };
  }
}

async function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  try {
    await mkdir(normalized.storage.metadataDirectory, { recursive: true });
    await mkdir(path.dirname(settingsPath()), { recursive: true });
    const temporaryPath = `${settingsPath()}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, settingsPath());
    if (normalized.storage.metadataDirectory !== appSettings.storage.metadataDirectory) metadataStore = new VideoMetadataStore(normalized.storage.metadataDirectory);
    appSettings = normalized;
    hasSettingsFile = true;
    return { settings: appSettings };
  } catch (error) {
    return { error: `Не удалось сохранить config.json: ${error.message}` };
  }
}

if (require('electron-squirrel-startup')) app.quit();

Menu.setApplicationMenu(null);

function createWindow() {
  isRendererReady = false;
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 880,
    minWidth: 980,
    minHeight: 640,
    title: APP_TITLE,
    icon: nativeImage.createFromPath(path.join(__dirname, 'assets', 'folder-video.ico')),
    backgroundColor: '#101216',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  // Local file URLs are stable between packaged builds, so clear Chromium's cache
  // before loading the renderer to avoid running a stale app.js after an update.
  mainWindow.webContents.once('did-finish-load', () => {
    isRendererReady = true;
    if (pendingLaunchTarget) {
      mainWindow.webContents.send('folder-video:open-target', pendingLaunchTarget);
      pendingLaunchTarget = null;
    }
  });
  mainWindow.webContents.session.clearCache()
    .catch(() => {})
    .finally(() => { mainWindow.loadFile('index.html'); });
}

async function getLaunchTarget(argv) {
  for (const candidate of argv.slice(1).reverse()) {
    if (typeof candidate !== 'string' || candidate.startsWith('-')) continue;
    try {
      const targetPath = path.resolve(candidate);
      if (targetPath === app.getAppPath()) continue;
      const stat = await lstat(targetPath);
      if (stat.isDirectory()) return { type: 'folder', path: targetPath };
      if (stat.isFile() && VIDEO_EXTENSIONS.has(path.extname(targetPath).toLowerCase())) return { type: 'video', path: targetPath, folderPath: path.dirname(targetPath) };
    } catch {}
  }
  return null;
}

async function openLaunchTarget(argv) {
  const target = await getLaunchTarget(argv);
  if (!target) return;
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (!mainWindow) {
    pendingLaunchTarget = target;
    if (app.isReady()) createWindow();
    return;
  }
  if (!isRendererReady) {
    pendingLaunchTarget = target;
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  mainWindow.webContents.send('folder-video:open-target', target);
}

function openMetadataStore() { metadataStore = new VideoMetadataStore(appSettings.storage.metadataDirectory); }

async function ensureMetadataTemplate() {
  const templatePath = path.join(appSettings.storage.metadataDirectory, 'template.html');
  try { await readFile(templatePath, 'utf8'); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(appSettings.storage.metadataDirectory, { recursive: true });
    await writeFile(templatePath, DEFAULT_METADATA_TEMPLATE, 'utf8');
  }
  return templatePath;
}

function isYouTubeUrl(value) {
  if (!value) return true;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (host === 'youtu.be' || host.endsWith('.youtu.be') || host === 'youtube.com' || host.endsWith('.youtube.com'));
  } catch {
    return false;
  }
}

function isObsidianUrl(value) { return !value || value.startsWith('obsidian://'); }

function outputPathForSpeedUp(filePath) {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}_2x${parsed.ext}`);
}

function speedUpCodecArguments(extension) {
  switch (extension.toLowerCase()) {
    case '.webm': return ['-c:v', 'libvpx-vp9', '-c:a', 'libopus'];
    case '.ogv': return ['-c:v', 'libtheora', '-c:a', 'libvorbis'];
    case '.avi': return ['-c:v', 'mpeg4', '-c:a', 'libmp3lame'];
    default: return ['-c:v', 'libx264', '-c:a', 'aac'];
  }
}

function runFfmpeg(arguments_, onProgress) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    let progressBuffer = '';
    const child = spawn('ffmpeg', arguments_, { windowsHide: true });
    child.once('error', reject);
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    child.stdout.on('data', chunk => {
      progressBuffer += chunk.toString();
      const lines = progressBuffer.split(/\r?\n/);
      progressBuffer = lines.pop();
      lines.forEach(line => {
        const separator = line.indexOf('=');
        if (separator !== -1) onProgress(line.slice(0, separator), line.slice(separator + 1));
      });
    });
    child.once('close', code => code === 0 ? resolve() : reject(new Error(stderr || `FFmpeg завершился с кодом ${code}`)));
  });
}

function runGit(directory, args) {
  return new Promise(resolve => {
    const child = spawn('git', args, { cwd: directory, windowsHide: true }); let output = '';
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-8000); }); child.stderr.on('data', chunk => { output = (output + chunk).slice(-8000); });
    child.once('error', error => resolve({ ok: false, output: error.message })); child.once('close', code => resolve({ ok: code === 0, output: output.trim() }));
  });
}

ipcMain.handle('folder-video:sync-metadata', async () => {
  const { metadataDirectory, gitRepositoryUrl } = appSettings.storage;
  if (!gitRepositoryUrl) return { error: 'В настройках не указан URL Git-репозитория.' };
  await mkdir(metadataDirectory, { recursive: true });
  const probe = await runGit(metadataDirectory, ['rev-parse', '--is-inside-work-tree']);
  if (!probe.ok) return { error: 'Каталог метаданных не является Git-репозиторием. Клонируйте репозиторий в этот каталог.', details: probe.output };
  const remote = await runGit(metadataDirectory, ['remote', 'get-url', 'origin']);
  const remoteResult = remote.ok
    ? await runGit(metadataDirectory, ['remote', 'set-url', 'origin', gitRepositoryUrl])
    : await runGit(metadataDirectory, ['remote', 'add', 'origin', gitRepositoryUrl]);
  if (!remoteResult.ok) return { error: 'Не удалось настроить удалённый Git-репозиторий.', details: remoteResult.output };
  const pull = await runGit(metadataDirectory, ['pull', '--rebase']);
  if (!pull.ok) return { error: 'Конфликт Git: синхронизация остановлена.', details: pull.output };
  const add = await runGit(metadataDirectory, ['add', '-A']);
  if (!add.ok) return { error: 'Не удалось подготовить изменения Git.', details: add.output };
  const changed = await runGit(metadataDirectory, ['diff', '--cached', '--quiet']);
  if (!changed.ok) {
    const commit = await runGit(metadataDirectory, ['commit', '-m', 'Обновить метаданные видео']);
    if (!commit.ok) return { error: 'Не удалось создать Git-коммит.', details: commit.output };
  }
  const push = await runGit(metadataDirectory, ['push']);
  return push.ok ? { success: true, details: push.output } : { error: 'Не удалось отправить изменения в Git.', details: push.output };
});

function preserveWindowsFileDates(sourcePath, destinationPath) {
  const command = '$source = Get-Item -LiteralPath $env:FOLDER_VIDEO_SOURCE; $destination = Get-Item -LiteralPath $env:FOLDER_VIDEO_DESTINATION; $destination.CreationTime = $source.CreationTime; $destination.LastWriteTime = $source.LastWriteTime; $destination.LastAccessTime = $source.LastAccessTime';
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, env: { ...process.env, FOLDER_VIDEO_SOURCE: sourcePath, FOLDER_VIDEO_DESTINATION: destinationPath } });
    let stderr = '';
    child.once('error', reject);
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('close', code => code === 0 ? resolve() : reject(new Error(stderr || 'Не удалось сохранить даты файла')));
  });
}

function validateMetadata(metadata) {
  if (!metadata || typeof metadata.contentHash !== 'string' || !/^[a-f0-9]{64}$/i.test(metadata.contentHash)) return 'Не удалось идентифицировать видео';
  if (typeof metadata.title !== 'string' || typeof metadata.originalFileName !== 'string' || typeof metadata.youtubeUrl !== 'string' || typeof metadata.obsidianUrl !== 'string' || typeof metadata.projectFolder !== 'string' || typeof metadata.descriptionMarkdown !== 'string' || !Array.isArray(metadata.tags)) return 'Некорректные данные';
  if (!isYouTubeUrl(metadata.youtubeUrl)) return 'Укажите корректную ссылку YouTube';
  if (!isObsidianUrl(metadata.obsidianUrl)) return 'Obsidian-ссылка должна начинаться с obsidian://';
  return null;
}

function toVideoItem(filePath, stat) {
  return {
    id: filePath,
    path: filePath,
    url: pathToFileURL(filePath).href,
    name: path.basename(filePath),
    size: stat.size,
    lastModified: stat.mtimeMs
  };
}

async function scanFolder(root, recursive) {
  const files = [];
  let skipped = 0;

  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      skipped += 1;
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        skipped += 1;
        continue;
      }
      if (entry.isDirectory()) {
        if (recursive) await walk(entryPath);
        continue;
      }
      if (!entry.isFile() || !VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      try {
        files.push(toVideoItem(entryPath, await lstat(entryPath)));
      } catch {
        skipped += 1;
      }
    }
  }

  await walk(root);
  return { files, skipped };
}

ipcMain.handle('folder-video:choose-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('folder-video:scan', async (_event, folderPath, recursive) => {
  if (typeof folderPath !== 'string' || typeof recursive !== 'boolean') {
    throw new Error('Invalid scan request');
  }
  return scanFolder(folderPath, recursive);
});

ipcMain.handle('folder-video:read-video', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return null;
  try {
    const stat = await lstat(filePath);
    return stat.isFile() ? toVideoItem(filePath, stat) : null;
  } catch {
    return null;
  }
});

ipcMain.handle('folder-video:show-in-folder', async (_event, filePath) => {
  if (typeof filePath === 'string') shell.showItemInFolder(filePath);
});

ipcMain.handle('folder-video:open-in-system-player', async (_event, filePath) => {
  if (typeof filePath !== 'string') return 'Invalid video path';
  return shell.openPath(filePath);
});

ipcMain.handle('folder-video:copy-path', async (_event, filePath) => {
  if (typeof filePath === 'string') {
    clipboard.writeText(filePath);
    return true;
  }
  return false;
});

ipcMain.handle('folder-video:copy-image', async (_event, imageData) => {
  const webpDataUrl = imageData && imageData.webpDataUrl;
  const bitmapDataUrl = imageData && imageData.bitmapDataUrl;
  if (typeof webpDataUrl !== 'string' || !webpDataUrl.startsWith('data:image/webp;base64,')) return { error: 'Некорректное WebP-изображение' };
  if (typeof bitmapDataUrl !== 'string' || !bitmapDataUrl.startsWith('data:image/png;base64,')) return { error: 'Некорректное изображение для буфера' };

  const image = nativeImage.createFromDataURL(bitmapDataUrl);
  if (image.isEmpty()) return { error: 'Не удалось подготовить изображение для буфера' };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    clipboard.clear();
    clipboard.writeImage(image);
    if (!clipboard.readImage().isEmpty()) return { success: true };
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return { error: 'Windows не принял изображение в буфер обмена' };
});

ipcMain.handle('folder-video:metadata-load', async (_event, requestId, filePath) => {
  if (typeof requestId !== 'string' || typeof filePath !== 'string' || !VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return { error: 'Некорректный файл' };
  const controller = new AbortController();
  metadataJobs.set(requestId, controller);
  try {
    const contentHash = await hashFile(filePath, controller.signal);
    if (controller.signal.aborted) return { canceled: true };
    return { metadata: await metadataStore.load(contentHash, path.basename(filePath)) };
  } catch (error) {
    if (error.name === 'AbortError') return { canceled: true };
    return { error: error.message || 'Не удалось вычислить хеш файла' };
  } finally {
    if (metadataJobs.get(requestId) === controller) metadataJobs.delete(requestId);
  }
});

ipcMain.handle('folder-video:metadata-cancel', (_event, requestId) => {
  const controller = metadataJobs.get(requestId);
  if (controller) controller.abort();
});
ipcMain.handle('folder-video:metadata-template', async () => {
  try { return { template: await readFile(await ensureMetadataTemplate(), 'utf8') }; } catch { return { template: '' }; }
});

ipcMain.handle('folder-video:metadata-save', async (_event, metadata) => {
  const error = validateMetadata(metadata);
  try { return error ? { error } : { metadata: await metadataStore.save(metadata) }; } catch (saveError) { return { error: saveError.message }; }
});

ipcMain.handle('folder-video:render-markdown', async (_event, markdown) => {
  if (typeof markdown !== 'string') return '';
  const { marked } = await import('marked');
  return marked.parse(markdown, { async: false, breaks: true, renderer: { html() { return ''; } } });
});

ipcMain.handle('folder-video:open-metadata-link', async (_event, url) => {
  if (typeof url !== 'string' || (!isYouTubeUrl(url) && !isObsidianUrl(url))) return 'Некорректная ссылка';
  return shell.openExternal(url);
});
ipcMain.handle('folder-video:open-project-folder', async (_event, folderPath) => {
  if (typeof folderPath !== 'string' || !folderPath.trim()) return 'Папка проекта не задана';
  return shell.openPath(folderPath);
});

ipcMain.handle('folder-video:delete-file', async (event, filePath) => {
  if (typeof filePath !== 'string' || !VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return { error: 'Invalid video path' };
  try {
    const stat = await lstat(filePath);
    if (!stat.isFile()) return { error: 'Файл не найден' };
  } catch {
    return { error: 'Файл не найден' };
  }
  const result = await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), {
    type: 'warning',
    title: 'Удалить видео?',
    message: `Переместить «${path.basename(filePath)}» в корзину?`,
    detail: 'Восстановить файл можно через корзину Windows.',
    buttons: ['Удалить', 'Отмена'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  });
  if (result.response !== 0) return { canceled: true };
  try {
    await shell.trashItem(filePath);
    return { success: true };
  } catch (error) {
    return { error: error.message || 'Не удалось удалить файл' };
  }
});

ipcMain.handle('folder-video:move-file', async (_event, sourcePath) => {
  if (typeof sourcePath !== 'string') return { error: 'Invalid path' };
  const result = await dialog.showOpenDialog({
    title: 'Выберите папку для перемещения',
    properties: ['openDirectory']
  });
  if (result.canceled) return { canceled: true };
  const dest = path.join(result.filePaths[0], path.basename(sourcePath));
  const isSamePath = process.platform === 'win32'
    ? path.resolve(sourcePath).toLowerCase() === path.resolve(dest).toLowerCase()
    : path.resolve(sourcePath) === path.resolve(dest);
  if (isSamePath) return { error: 'Выберите другую папку' };

  let sourceInfo;
  try {
    sourceInfo = await lstat(sourcePath);
  } catch (error) {
    return { error: error.message || 'Не удалось прочитать исходный файл' };
  }

  let destinationInfo;
  try {
    destinationInfo = await lstat(dest);
  } catch (error) {
    if (error.code !== 'ENOENT') return { error: error.message || 'Не удалось проверить папку назначения' };
  }
  if (destinationInfo?.isDirectory()) {
    return { error: 'В папке назначения уже есть папка с таким именем' };
  }

  const formatSize = size => {
    if (size < 1024) return `${size} Б`;
    const units = ['КБ', 'МБ', 'ГБ', 'ТБ'];
    let value = size / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ${units[unit]}`;
  };

  if (destinationInfo) {
    const conflict = await dialog.showMessageBox({
      type: 'warning',
      title: 'Файл уже существует',
      message: `В выбранной папке уже есть «${path.basename(sourcePath)}».`,
      detail: [
        'Исходный файл:',
        `Имя: ${path.basename(sourcePath)}`,
        `Путь: ${sourcePath}`,
        `Размер: ${formatSize(sourceInfo.size)}`,
        '',
        'Файл в папке назначения:',
        `Имя: ${path.basename(dest)}`,
        `Путь: ${dest}`,
        `Размер: ${formatSize(destinationInfo.size)}`
      ].join('\n'),
      buttons: ['Заменить', 'Удалить исходный', 'Отмена'],
      defaultId: 2,
      cancelId: 2,
      noLink: true
    });
    if (conflict.response === 2) return { canceled: true };
    if (conflict.response === 1) {
      try {
        await shell.trashItem(sourcePath);
        return { success: true, sourceDeleted: true };
      } catch (error) {
        return { error: error.message || 'Не удалось переместить исходный файл в корзину' };
      }
    }
  }

  const moveWithRetry = async (from, to) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rename(from, to);
        return { success: true };
      } catch (error) {
        if (error.code === 'EXDEV') {
          try {
            await copyFile(from, to);
            try {
              await unlink(from);
            } catch (unlinkError) {
              await unlink(to).catch(() => {});
              return { error: unlinkError };
            }
            return { success: true };
          } catch (copyError) {
            return { error: copyError };
          }
        }
        if (error.code !== 'EBUSY' && error.code !== 'EPERM') return { error };
        if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 400));
      }
    }
    return { error: new Error('Файл занят системой. Закройте плеер и попробуйте снова.') };
  };

  let backupPath;
  if (destinationInfo) {
    backupPath = path.join(
      path.dirname(dest),
      `.${path.basename(dest)}.folder-video-backup-${Date.now()}-${process.pid}`
    );
    const backup = await moveWithRetry(dest, backupPath);
    if (!backup.success) return { error: backup.error.message || 'Не удалось подготовить замену файла' };
  }

  const moved = await moveWithRetry(sourcePath, dest);
  if (!moved.success) {
    if (backupPath) {
      await rename(backupPath, dest).catch(() => {});
    }
    return { error: moved.error.message || 'Не удалось переместить файл' };
  }

  if (backupPath) {
    try {
      await shell.trashItem(backupPath);
    } catch (error) {
      return { success: true, dest, warning: 'Новый файл перемещён, но прежний не удалось отправить в корзину.' };
    }
  }
  return { success: true, dest };
});
ipcMain.handle('folder-video:speed-up', async (event, sourcePath, operationId, durationSeconds) => {
  if (typeof sourcePath !== 'string' || !VIDEO_EXTENSIONS.has(path.extname(sourcePath).toLowerCase())) return { error: 'Некорректный путь к видео' };
  if (typeof operationId !== 'string' || !operationId) return { error: 'Некорректная операция' };
  try {
    const sourceInfo = await lstat(sourcePath);
    if (!sourceInfo.isFile()) return { error: 'Указанный путь не является файлом' };
  } catch (error) { return { error: error.message || 'Не удалось прочитать исходный файл' }; }
  const outputPath = outputPathForSpeedUp(sourcePath);
  try {
    await lstat(outputPath);
    const overwrite = await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), { type: 'warning', title: 'Ускоренный файл уже существует', message: `Заменить «${path.basename(outputPath)}»?`, detail: 'Прежний ускоренный файл будет перемещён в корзину Windows.', buttons: ['Заменить', 'Отмена'], defaultId: 1, cancelId: 1, noLink: true });
    if (overwrite.response !== 0) return { canceled: true };
    await shell.trashItem(outputPath);
  } catch (error) {
    if (error.code !== 'ENOENT') return { error: error.message || 'Не удалось подготовить файл назначения' };
  }
  const outputDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds / 2 : 0;
  const sendProgress = percent => { if (!event.sender.isDestroyed()) event.sender.send('folder-video:speed-up-progress', { operationId, percent: Math.max(0, Math.min(100, Math.round(percent))) }); };
  sendProgress(0);
  try {
    await runFfmpeg(['-hide_banner', '-nostats', '-progress', 'pipe:1', '-y', '-i', sourcePath, '-map', '0:v?', '-map', '0:a?', '-map_metadata', '0', '-filter:v', 'setpts=0.5*PTS', '-filter:a', 'atempo=2.0', ...speedUpCodecArguments(path.extname(sourcePath)), outputPath], (key, value) => {
      if ((key === 'out_time_us' || key === 'out_time_ms') && outputDuration) sendProgress(Number(value) / 1000000 / outputDuration * 100);
    });
    await preserveWindowsFileDates(sourcePath, outputPath);
    sendProgress(100);
    return { success: true, outputPath };
  } catch (error) { return { error: error.message || 'Не удалось ускорить видео' }; }
});

ipcMain.handle('folder-video:set-title', (event, folderPath) => {
  const title = typeof folderPath === 'string' && folderPath
    ? `${APP_TITLE} (${folderPath})`
    : APP_TITLE;
  BrowserWindow.fromWebContents(event.sender)?.setTitle(title);
});

ipcMain.handle('folder-video:get-app-info', () => ({ version: APP_VERSION }));
ipcMain.handle('folder-video:get-settings', () => ({ settings: appSettings, hasConfig: hasSettingsFile }));
ipcMain.handle('folder-video:get-default-settings', () => ({ settings: defaultSettings() }));
ipcMain.handle('folder-video:save-settings', async (_event, settings) => saveSettings(settings));
ipcMain.handle('folder-video:confirm-close-settings', async event => {
  const result = await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), {
    type: 'question', title: 'Несохранённые настройки', message: 'Сохранить изменения перед закрытием вкладки?',
    buttons: ['Сохранить', 'Не сохранять', 'Отмена'], defaultId: 0, cancelId: 2, noLink: true
  });
  return ['save', 'discard', 'cancel'][result.response];
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => { openLaunchTarget(argv); });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await loadSettings();
  openMetadataStore();
  createWindow();
  openLaunchTarget(process.argv);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
