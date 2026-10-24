const { app, BrowserWindow, dialog, ipcMain, shell, nativeImage, Menu, clipboard, safeStorage, net } = require('electron');
const { readdir, lstat, rename, copyFile, unlink, readFile, writeFile, mkdir, rm, mkdtemp } = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { VideoMetadataStore } = require('./video-metadata-store');
const { hashFile } = require('./hash-file');
const { createSameFileMoveConflict } = require('./move-file-conflict');
const { UNDO_DIRECTORY, CutUndoStore } = require('./cut-undo');
const { reencodeCodecArguments } = require('./cut-core');
const { probeDuration, listKeyframes, planCut, executeCut } = require('./cut-ffmpeg');
const { shiftNotes } = require('./notes-core');
const youtubeLink = require('./youtube-link-core');
const { readAuthorUrl, writeAuthorUrl } = require('./author-url-property');
const { PeakCollector, SAMPLE_RATE, BINS_PER_SECOND } = require('./waveform-core');
const { RELEASES_API, compareVersions, latestRelease } = require('./update-core');
const { srtSegments, transcriptBatches, normalizeSummary, FRAME_COUNT, frameTimes, parseVideoLink, parseRegValue, playerLaunch, safeNoteName, buildObsidianArticle, buildObsidianAddendum } = require('./summary-core');

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
const transcriptJobs = new Map();
const summaryJobs = new Map();
const obsidianJobs = new Set();
const notesSaveJobs = new Map();
let pendingLaunchTarget = null;
let isRendererReady = false;
let appSettings;
let hasSettingsFile = false;

function defaultSettings() {
  return {
    version: 1,
    autoUpdate: true,
    theme: 'dark',
    storage: { metadataDirectory: path.join(app.getPath('documents'), 'folder-video-metadata'), gitRepositoryUrl: '', obsidianInbox: 'C:\\_ObsidianDB\\ai-study\\00 Inbox', transcriptDirectory: path.join(app.getPath('userData'), 'transcripts') },
    viewer: { columns: 3, seconds: 10, scroll: 'center', panelWidth: 410 },
    interface: { metadataCollapsed: false, gridCollapsed: false },
    cut: { replaceOriginal: true },
    transcription: { modelPath: '' },
    ai: { model: 'deepseek-flash', apiKey: '', keyConfigured: false, clearKey: false }
  };
}

function normalizeSettings(value) {
  const defaults = defaultSettings();
  const source = value && typeof value === 'object' ? value : {};
  const columns = [3, 4, 5, 6, 8].includes(source.viewer?.columns) ? source.viewer.columns : defaults.viewer.columns;
  const seconds = [5, 10, 15, 30, 60].includes(source.viewer?.seconds) ? source.viewer.seconds : defaults.viewer.seconds;
  const scroll = ['center', 'edge', 'off'].includes(source.viewer?.scroll) ? source.viewer.scroll : defaults.viewer.scroll;
  const panelWidth = Number.isFinite(source.viewer?.panelWidth) ? Math.max(280, Math.min(720, Math.round(source.viewer.panelWidth))) : defaults.viewer.panelWidth;
  const metadataDirectory = typeof source.storage?.metadataDirectory === 'string' && source.storage.metadataDirectory.trim()
    ? path.resolve(source.storage.metadataDirectory) : defaults.storage.metadataDirectory;
  const gitRepositoryUrl = typeof source.storage?.gitRepositoryUrl === 'string' ? source.storage.gitRepositoryUrl.trim() : '';
  const obsidianInbox = typeof source.storage?.obsidianInbox === 'string' && source.storage.obsidianInbox.trim()
    ? path.resolve(source.storage.obsidianInbox) : defaults.storage.obsidianInbox;
  const transcriptDirectory = typeof source.storage?.transcriptDirectory === 'string' && source.storage.transcriptDirectory.trim()
    ? path.resolve(source.storage.transcriptDirectory) : defaults.storage.transcriptDirectory;
  return {
    version: 1,
    autoUpdate: source.autoUpdate !== false,
    theme: source.theme === 'light' ? 'light' : 'dark',
    storage: { metadataDirectory, gitRepositoryUrl, obsidianInbox, transcriptDirectory }, viewer: { columns, seconds, scroll, panelWidth },
    interface: { metadataCollapsed: source.interface?.metadataCollapsed === true, gridCollapsed: source.interface?.gridCollapsed === true },
    cut: { replaceOriginal: source.cut?.replaceOriginal !== false },
    transcription: { modelPath: typeof source.transcription?.modelPath === 'string' ? source.transcription.modelPath.trim() : '' },
    ai: { model: typeof source.ai?.model === 'string' && source.ai.model.trim() ? source.ai.model.trim() : 'deepseek-flash', apiKey: '', keyConfigured: false, clearKey: false }
  };
}

function settingsPath() { return path.join(app.getPath('userData'), 'config.json'); }
function deepSeekKeyPath() { return path.join(app.getPath('userData'), 'deepseek-key.bin'); }
async function hasDeepSeekKey() {
  try { return Boolean(safeStorage.decryptString(await readFile(deepSeekKeyPath()))); }
  catch { return false; }
}
async function readDeepSeekKey() {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Шифрование ключа недоступно в этой системе.');
  try { return safeStorage.decryptString(await readFile(deepSeekKeyPath())); }
  catch { throw new Error('Ключ DeepSeek не найден или не удалось его расшифровать. Укажите ключ заново в настройках.'); }
}

async function loadSettings() {
  try {
    const value = JSON.parse(await readFile(settingsPath(), 'utf8'));
    appSettings = normalizeSettings(value);
    appSettings.ai.keyConfigured = await hasDeepSeekKey();
    hasSettingsFile = true;
    return { settings: appSettings };
  } catch (error) {
    appSettings = defaultSettings();
    appSettings.ai.keyConfigured = await hasDeepSeekKey();
    hasSettingsFile = false;
    return { settings: appSettings, warning: error.code === 'ENOENT' ? null : 'Не удалось прочитать config.json; использованы настройки по умолчанию.' };
  }
}

async function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  try {
    const newKey = typeof settings?.ai?.apiKey === 'string' ? settings.ai.apiKey.trim() : '';
    if (newKey && !safeStorage.isEncryptionAvailable()) return { error: 'Шифрование ключа недоступно в этой системе.' };
    await mkdir(normalized.storage.metadataDirectory, { recursive: true });
    await mkdir(normalized.storage.transcriptDirectory, { recursive: true });
    await mkdir(path.dirname(settingsPath()), { recursive: true });
    if (newKey) await writeFile(deepSeekKeyPath(), safeStorage.encryptString(newKey));
    else if (settings?.ai?.clearKey === true) await unlink(deepSeekKeyPath()).catch(error => { if (error.code !== 'ENOENT') throw error; });
    normalized.ai.keyConfigured = await hasDeepSeekKey();
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

// Match the AppUserModelID written by Squirrel into Start menu and taskbar shortcuts.
app.setAppUserModelId('com.squirrel.folder_video.folder-video');
Menu.setApplicationMenu(null);

let updateState = { busy: false, message: '', error: false };
let updatePreparation = null;

function setUpdateState(busy, message, error = false) {
  updateState = { busy, message, error };
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('folder-video:update-status', updateState);
  }
  return updateState;
}

async function installedUpdateExe() {
  if (!app.isPackaged || process.platform !== 'win32' || process.arch !== 'x64' || !process.env.LOCALAPPDATA) return null;
  const root = path.join(process.env.LOCALAPPDATA, 'folder_video');
  const expected = path.join(root, `app-${APP_VERSION}`, 'folder-video.exe');
  if (path.resolve(process.execPath).toLowerCase() !== path.resolve(expected).toLowerCase()) return null;
  const executable = path.join(root, 'Update.exe');
  return await lstat(executable).then(stat => stat.isFile() ? executable : null, () => null);
}

async function fetchUpdateRelease() {
  const signal = AbortSignal.timeout(15000);
  let latest = null;
  // Общий репозиторий: релизы других приложений могут занимать всю первую страницу.
  for (let page = 1; ; page++) {
    const response = await net.fetch(`${RELEASES_API}?per_page=100&page=${page}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Folder-video', 'X-GitHub-Api-Version': '2022-11-28' }, signal
    });
    if (!response.ok) throw new Error(`GitHub ответил ${response.status}`);
    const list = await response.json();
    if (!Array.isArray(list)) throw new Error('Некорректный ответ GitHub');
    const candidate = latestRelease(list);
    if (candidate && (!latest || compareVersions(candidate.version, latest.version) > 0)) latest = candidate;
    if (list.length < 100) return latest;
  }
}

function prepareRendererForUpdate() {
  const window = BrowserWindow.getAllWindows()[0];
  if (!window || window.isDestroyed() || !isRendererReady) throw new Error('Окно приложения ещё не готово. Повторите проверку.');
  return new Promise((resolve, reject) => {
    const id = createHash('sha256').update(`${Date.now()}-${Math.random()}`).digest('hex');
    const timer = setTimeout(() => {
      updatePreparation = null;
      reject(new Error('Не удалось дождаться сохранения заметок. Повторите обновление.'));
    }, 15000);
    updatePreparation = { id, sender: window.webContents, finish(error) {
      clearTimeout(timer);
      updatePreparation = null;
      if (error) reject(new Error(error)); else resolve();
    } };
    window.webContents.send('folder-video:update-prepare', id);
  });
}

function updateWorkInProgress() {
  return cutJob || transcriptJobs.size || summaryJobs.size || obsidianJobs.size || metadataJobs.size;
}

function powershellLiteral(value) { return "'" + value.replace(/'/g, "''") + "'"; }

async function installUpdate(release, updateExe) {
  const tempRoot = path.resolve(app.getPath('temp'));
  const directory = await mkdtemp(path.join(tempRoot, 'folder-video-update-'));
  // Проверка также ограничивает рекурсивное удаление в отдельном процессе установки.
  if (path.dirname(directory) !== tempRoot || !path.basename(directory).startsWith('folder-video-update-')) throw new Error('Некорректный временный каталог');
  const file = path.join(directory, 'folder-video-setup.exe');
  const log = path.join(app.getPath('userData'), 'update-error.txt');
  let handedOff = false;
  try {
    setUpdateState(true, `Загрузка обновления ${release.version}…`);
    const signal = AbortSignal.timeout(10 * 60 * 1000);
    const response = await net.fetch(release.url, { headers: { 'User-Agent': 'Folder-video' }, signal });
    if (!response.ok || !response.body) throw new Error(`Не удалось скачать установщик: HTTP ${response.status}`);
    const hash = createHash('sha256');
    let received = 0;
    let lastPercent = -1;
    const progress = new Transform({ transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > release.size) return callback(new Error('Размер установщика превышает указанный в релизе'));
      hash.update(chunk);
      const percent = Math.floor(received * 100 / release.size);
      if (percent !== lastPercent) {
        lastPercent = percent;
        setUpdateState(true, `Загрузка обновления ${release.version}: ${percent}%`);
      }
      callback(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(file, { flags: 'wx' }), { signal });
    if (received !== release.size) throw new Error('Установщик скачан не полностью');
    if (release.sha256 && hash.digest('hex') !== release.sha256) throw new Error('Контрольная сумма SHA-256 установщика не совпала');
    if (updateWorkInProgress()) throw new Error('Дождитесь завершения обработки видео и повторите обновление.');
    await prepareRendererForUpdate();
    await Promise.all(notesSaveJobs.values());
    if (updateWorkInProgress()) throw new Error('Дождитесь завершения обработки видео и повторите обновление.');
    await mkdir(app.getPath('userData'), { recursive: true });
    await rm(log, { force: true });
    // Без cmd.exe: пути передаются литералами PowerShell, включая пробелы и апострофы.
    // Помощник ждёт фактического выхода приложения, затем устанавливает и запускает его.
    const script = `$ErrorActionPreference = 'Stop'
try {
  Wait-Process -Id ${process.pid} -Timeout 120 -ErrorAction SilentlyContinue
  if (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) { throw 'Приложение не завершилось за 120 секунд' }
  $installer = Start-Process -FilePath ${powershellLiteral(file)} -ArgumentList '--silent' -Wait -PassThru -WindowStyle Hidden
  if ($installer.ExitCode -ne 0) { throw "Установщик завершился с кодом $($installer.ExitCode)" }
} catch {
  [System.IO.File]::WriteAllText(${powershellLiteral(log)}, $_.Exception.Message)
} finally {
  Remove-Item -LiteralPath ${powershellLiteral(directory)} -Recurse -Force -ErrorAction SilentlyContinue
  Start-Process -FilePath ${powershellLiteral(updateExe)} -ArgumentList '--processStart', 'folder-video.exe' -WindowStyle Hidden
}`;
    await new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { detached: true, stdio: 'ignore', windowsHide: true });
      child.once('error', reject);
      child.once('spawn', () => { child.unref(); resolve(); });
    });
    handedOff = true;
    setUpdateState(true, 'Установка обновления. Приложение перезапустится…');
    app.quit();
  } finally {
    if (!handedOff) await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

async function checkForUpdate(manual) {
  if (updateState.busy) return updateState;
  setUpdateState(true, 'Проверка обновлений…');
  let accepted = false;
  try {
    const updateExe = await installedUpdateExe();
    if (!updateExe) return setUpdateState(false, manual ? 'Обновление доступно в Windows x64 после установки через folder-video-setup.exe.' : '');
    const release = await fetchUpdateRelease();
    if (!release || compareVersions(release.version, APP_VERSION) <= 0) return setUpdateState(false, `Установлена последняя версия (${APP_VERSION}).`);
    if (updateWorkInProgress()) return setUpdateState(false, 'Доступно обновление. Повторите проверку после завершения обработки видео.');
    const window = BrowserWindow.getAllWindows()[0];
    if (!window || window.isDestroyed()) return setUpdateState(false, '');
    const result = await dialog.showMessageBox(window, {
      type: 'question', title: 'Обновление Folder-video',
      message: `Доступна версия ${release.version} (сейчас ${APP_VERSION}).`,
      detail: 'Приложение скачает установщик, закроется и запустится снова.' + (release.notes ? `\n\n${release.notes.slice(0, 6000)}` : ''),
      buttons: ['Обновить', 'Позже'], defaultId: 0, cancelId: 1, noLink: true
    });
    if (result.response !== 0) return setUpdateState(false, `Доступна версия ${release.version}.`);
    accepted = true;
    await installUpdate(release, updateExe);
    return updateState;
  } catch (error) {
    const message = `Не удалось ${accepted ? 'установить' : 'проверить'} обновление: ${error.message}`;
    const result = setUpdateState(false, manual || accepted ? message : '', manual || accepted);
    if (accepted && !manual) await dialog.showMessageBox({ type: 'error', title: 'Обновление Folder-video', message });
    return result;
  }
}

function createWindow() {
  isRendererReady = false;
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 880,
    minWidth: 980,
    minHeight: 640,
    title: APP_TITLE,
    icon: nativeImage.createFromPath(path.join(__dirname, 'assets', 'folder-video.png')),
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
    // Если отдельный установщик завершился с ошибкой, сообщаем после повторного запуска.
    const updateLog = path.join(app.getPath('userData'), 'update-error.txt');
    readFile(updateLog, 'utf8').then(async message => {
      setUpdateState(false, `Не удалось установить обновление: ${message}`, true);
      await dialog.showMessageBox(mainWindow, { type: 'error', title: 'Обновление Folder-video', message: 'Не удалось установить обновление', detail: message });
      await rm(updateLog, { force: true });
    }).catch(() => {});
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
    const link = parseVideoLink(candidate);
    if (link) {
      try {
        const targetPath = path.resolve(link.path);
        const stat = await lstat(targetPath);
        if (stat.isFile() && VIDEO_EXTENSIONS.has(path.extname(targetPath).toLowerCase())) return { type: 'play', path: targetPath, time: link.time };
      } catch {}
      continue;
    }
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

function queryRegistry(key, valueName) {
  return new Promise(resolve => {
    const args = ['query', key, ...(valueName ? ['/v', valueName] : ['/ve'])];
    const child = spawn('reg.exe', args, { windowsHide: true }); let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.once('error', () => resolve(''));
    child.once('close', code => resolve(code === 0 ? parseRegValue(output) : ''));
  });
}

// Команда плеера, назначенного в Windows для расширения: выбор пользователя, затем HKCR.
async function defaultPlayerCommand(extension) {
  const userChoice = await queryRegistry(`HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${extension}\\UserChoice`, 'ProgId');
  const progId = userChoice || await queryRegistry(`HKCR\\${extension}`);
  return progId ? queryRegistry(`HKCR\\${progId}\\shell\\open\\command`) : '';
}

// Ссылка folder-video:// из статьи Obsidian: видео открывается в системном плеере с нужной секунды.
async function playInSystemPlayer(target) {
  const command = process.platform === 'win32' ? await defaultPlayerCommand(path.extname(target.path).toLowerCase()) : '';
  const launch = command ? playerLaunch(command, target.path, target.time, process.env) : null;
  if (!launch) { await shell.openPath(target.path); return; }
  await new Promise(resolve => {
    const child = spawn(launch.executable, launch.args, { detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', async () => { await shell.openPath(target.path); resolve(); });
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

async function openLaunchTarget(argv) {
  const target = await getLaunchTarget(argv);
  if (!target) return;
  if (target.type === 'play') { await playInSystemPlayer(target); return; }
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

function transcriptDirectory() { return appSettings?.storage?.transcriptDirectory || path.join(app.getPath('userData'), 'transcripts'); }
function transcriptKey(filePath) { return createHash('sha256').update(filePath).digest('hex').slice(0, 12); }
function transcriptStem(filePath) {
  const parsed = path.parse(filePath);
  const safeName = parsed.name.replace(/[<>:"/\\|?*]/g, '_').slice(0, 120) || 'video';
  return `${safeName}__${transcriptKey(filePath)}`;
}
function transcriptPaths(filePath) {
  const stem = transcriptStem(filePath);
  const directory = transcriptDirectory();
  return { directory, stem, srtPath: path.join(directory, `${stem}.srt`), manifestPath: path.join(directory, `${stem}.json`) };
}
function notesPath(filePath) { return path.join(transcriptDirectory(), `${transcriptStem(filePath)}.notes.md`); }
async function validateNotesVideo(filePath) {
  if (typeof filePath !== 'string' || !VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase())) throw new Error('Некорректный путь к видео');
  const stat = await lstat(filePath);
  if (!stat.isFile()) throw new Error('Указанный путь не является файлом');
}
async function loadNotes(filePath) {
  try { await validateNotesVideo(filePath); }
  catch (error) { return { error: error.message || 'Не удалось открыть видео' }; }
  try { return { text: await readFile(notesPath(filePath), 'utf8') }; }
  catch (error) { return error.code === 'ENOENT' ? { text: '' } : { error: error.message || 'Не удалось открыть заметки' }; }
}
function saveNotes(filePath, text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 1048576) return Promise.resolve({ error: 'Заметки должны быть текстом размером до 1 МБ.' });
  const previous = notesSaveJobs.get(filePath) || Promise.resolve();
  const job = previous.catch(() => {}).then(async () => {
    try {
      await validateNotesVideo(filePath);
      await mkdir(transcriptDirectory(), { recursive: true });
      const target = notesPath(filePath);
      const temporary = `${target}.${process.pid}.tmp`;
      if (text.trim()) {
        try { await writeFile(temporary, text, 'utf8'); await rename(temporary, target); }
        catch (error) { await rm(temporary, { force: true }).catch(() => {}); throw error; }
      } else await rm(target, { force: true });
      return { success: true };
    } catch (error) { return { error: error.message || 'Не удалось сохранить заметки' }; }
  });
  notesSaveJobs.set(filePath, job);
  job.finally(() => { if (notesSaveJobs.get(filePath) === job) notesSaveJobs.delete(filePath); });
  return job;
}
function sourceSignature(filePath, stat) { return { filePath, size: stat.size, mtimeMs: stat.mtimeMs }; }
function isSameSource(manifest, signature) {
  return manifest && manifest.filePath === signature.filePath && manifest.size === signature.size && manifest.mtimeMs === signature.mtimeMs
    && (manifest.modelPath || '') === (appSettings.transcription?.modelPath || '');
}
async function loadTranscript(filePath) {
  if (typeof filePath !== 'string' || !VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return { error: 'Некорректный путь к видео' };
  let stat;
  try { stat = await lstat(filePath); if (!stat.isFile()) return { error: 'Указанный путь не является файлом' }; }
  catch (error) { return { error: error.message || 'Не удалось прочитать видео' }; }
  const paths = transcriptPaths(filePath);
  try {
    const manifest = JSON.parse(await readFile(paths.manifestPath, 'utf8'));
    if (!isSameSource(manifest, sourceSignature(filePath, stat))) return { stale: true };
    const srt = await readFile(paths.srtPath, 'utf8');
    return { available: true, srt, srtPath: paths.srtPath };
  } catch (error) {
    return error.code === 'ENOENT' ? { available: false } : { error: `Не удалось открыть транскрипцию: ${error.message}` };
  }
}
function transcriptionRuntime() {
  if (app.isPackaged) {
    const nativeRoot = path.join(process.resourcesPath, 'transcribe-native-windows-x86_64-cpu-vulkan');
    return { script: path.join(process.resourcesPath, 'transcribe_handy.py'), dll: path.join(nativeRoot, 'transcribe.dll') };
  }
  const nativeRoot = path.join(__dirname, 'tools', 'transcribe-cpp', 'transcribe-native-windows-x86_64-cpu-vulkan');
  return { script: path.join(__dirname, 'scripts', 'transcribe_handy.py'), dll: path.join(nativeRoot, 'transcribe.dll') };
}
function cancelTranscriptJob(job) {
  job.canceled = true;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(job.child.pid), '/T', '/F'], { windowsHide: true });
  else job.child.kill('SIGTERM');
}
async function runTranscript(event, filePath, operationId) {
  if (process.platform !== 'win32') return { error: 'Локальная транскрибация Parakeet TDT сейчас поддерживается только в Windows.' };
  if (typeof filePath !== 'string' || !VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return { error: 'Некорректный путь к видео' };
  let sourceStat;
  try {
    sourceStat = await lstat(filePath);
    if (!sourceStat.isFile()) return { error: 'Указанный путь не является файлом' };
  } catch (error) { return { error: error.message || 'Не удалось прочитать видео' }; }
  const runtime = transcriptionRuntime();
  const modelPath = appSettings.transcription?.modelPath || '';
  try { await Promise.all([lstat(runtime.script), lstat(runtime.dll)]); }
  catch { return { error: 'Не найдено окружение транскрибации. Переустановите приложение.' }; }
  if (modelPath) {
    try { if (!(await lstat(modelPath)).isFile()) return { error: 'Путь к модели Parakeet должен указывать на файл GGUF.' }; }
    catch (error) { return { error: `Модель Parakeet не найдена: ${error.message}` }; }
  }
  const paths = transcriptPaths(filePath);
  await mkdir(paths.directory, { recursive: true });
  return new Promise(resolve => {
    const args = [runtime.script, filePath, '--output-dir', paths.directory, '--output-stem', paths.stem, '--dll', runtime.dll];
    if (modelPath) args.push('--model', modelPath);
    const child = spawn('python', args, { windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' } });
    const job = { operationId, filePath, child, canceled: false };
    transcriptJobs.set(operationId, job);
    let stderr = '';
    let stdout = '';
    let settled = false;
    const finish = result => { if (!settled) { settled = true; resolve(result); } };
    const sendProgress = (currentSeconds, totalSeconds) => {
      if (!event.sender.isDestroyed() && totalSeconds > 0) event.sender.send('folder-video:transcript-progress', { operationId, percent: Math.max(0, Math.min(100, Math.round(currentSeconds / totalSeconds * 100))) });
    };
    child.stdout.on('data', chunk => {
      stdout = (stdout + chunk).slice(-6000);
      const match = stdout.match(/PROGRESS:(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)/g);
      if (match) { const parts = match[match.length - 1].split(':'); sendProgress(Number(parts[1]), Number(parts[2])); }
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-6000); });
    child.once('error', error => { transcriptJobs.delete(operationId); finish({ error: error.code === 'ENOENT' ? 'Python не найден в PATH. Установите Python или добавьте его в PATH.' : (error.message || 'Не удалось запустить Python') }); });
    child.once('close', async code => {
      transcriptJobs.delete(operationId);
      if (job.canceled) { finish({ canceled: true }); return; }
      if (code !== 0) { finish({ error: stderr || `Транскрипция завершилась с кодом ${code}` }); return; }
      try {
        const manifest = { ...sourceSignature(filePath, sourceStat), modelPath };
        await writeFile(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
        const result = await loadTranscript(filePath);
        finish(result.error ? result : { success: true, ...result });
      } catch (error) { finish({ error: error.message || 'Не удалось сохранить транскрипцию' }); }
    });
  });
}

function summaryPath(filePath) { return path.join(transcriptDirectory(), `${transcriptStem(filePath)}.summary.json`); }
function transcriptHash(srt) { return createHash('sha256').update(srt).digest('hex'); }
async function loadSummary(filePath) {
  const transcript = await loadTranscript(filePath);
  if (transcript.error) return transcript;
  if (!transcript.available) return { available: false, stale: Boolean(transcript.stale) };
  try {
    const saved = JSON.parse(await readFile(summaryPath(filePath), 'utf8'));
    const stat = await lstat(filePath);
    const valid = isSameSource(saved, sourceSignature(filePath, stat))
      && saved.transcriptHash === transcriptHash(transcript.srt)
      && saved.model === appSettings.ai.model;
    if (valid && (typeof saved.summary?.overview !== 'string' || !Array.isArray(saved.summary.topics)
      || saved.summary.topics.some(topic => typeof topic.title !== 'string' || !Number.isFinite(topic.start)))) {
      return { error: 'Сохранённая сводка повреждена. Создайте её заново.' };
    }
    return valid ? { available: true, summary: saved.summary } : { available: false, stale: true };
  } catch (error) {
    return error.code === 'ENOENT' ? { available: false } : { error: `Не удалось открыть сводку: ${error.message}` };
  }
}
async function askDeepSeek(key, model, source, partial, controller) {
  const instruction = partial
    ? 'Сделай краткую промежуточную сводку этого фрагмента и выдели до 5 основных тем.'
    : 'Сделай общую сводку в 1–3 абзацах и выдели до 10 основных тем в порядке появления.';
  const system = `Ты составляешь содержание видео только по транскрипции. Пиши по-русски. Не додумывай факты. ${instruction} Верни только JSON вида {"overview":"текст","topics":[{"title":"тема","description":"краткое описание","segmentIndex":1}]}. Для каждой темы укажи номер реально приведённого сегмента. Не выдумывай номера.`;
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: source }], thinking: { type: 'disabled' }, response_format: { type: 'json_object' }, max_tokens: 2400, stream: false })
    });
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json()).error?.message || ''; } catch {}
      throw new Error(`DeepSeek вернул HTTP ${response.status}${detail ? `: ${String(detail).slice(0, 250)}` : ''}`);
    }
    const body = await response.json();
    if (body.choices?.[0]?.finish_reason === 'length') throw new Error('DeepSeek обрезал ответ. Повторите запрос.');
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('DeepSeek вернул пустой ответ. Повторите запрос.');
    const parsed = JSON.parse(content);
    if (typeof parsed.overview !== 'string' || !Array.isArray(parsed.topics)) throw new Error('DeepSeek вернул сводку в неверном формате.');
    return parsed;
  } finally { clearTimeout(timeout); }
}
async function generateSummary(filePath, controller) {
  const transcript = await loadTranscript(filePath);
  if (transcript.error) throw new Error(transcript.error);
  if (!transcript.available) throw new Error('Сначала создайте актуальную транскрипцию видео.');
  const segments = srtSegments(transcript.srt);
  if (!segments.length) throw new Error('Транскрипция пуста; сводку создать нельзя.');
  const key = await readDeepSeekKey();
  const model = appSettings.ai.model;
  const batches = transcriptBatches(segments);
  let raw;
  let allowed = new Set(segments.map((_, index) => index + 1));
  if (batches.length === 1) raw = await askDeepSeek(key, model, batches[0].join('\n'), false, controller);
  else {
    const partials = [];
    const candidateIndices = new Set();
    for (const batch of batches) {
      const part = await askDeepSeek(key, model, batch.join('\n'), true, controller);
      const batchIndices = new Set(batch.map(line => Number(line.match(/^\[(\d+)\]/)[1])));
      const normalized = normalizeSummary(part, segments, batchIndices);
      partials.push({ overview: normalized.overview, topics: part.topics.filter(topic => batchIndices.has(Number(topic.segmentIndex))).slice(0, 5) });
      for (const topic of partials[partials.length - 1].topics) candidateIndices.add(Number(topic.segmentIndex));
    }
    allowed = candidateIndices;
    raw = await askDeepSeek(key, model, `Промежуточные сводки с номерами исходных сегментов:\n${JSON.stringify(partials)}`, false, controller);
  }
  const summary = normalizeSummary(raw, segments, allowed);
  if (controller.signal.aborted) throw new Error('Создание сводки отменено.');
  const stat = await lstat(filePath);
  const record = { ...sourceSignature(filePath, stat), modelPath: appSettings.transcription?.modelPath || '', transcriptHash: transcriptHash(transcript.srt), model, summary };
  const target = summaryPath(filePath);
  const temporary = `${target}.${process.pid}.tmp`;
  await mkdir(transcriptDirectory(), { recursive: true });
  try { await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8'); await rename(temporary, target); }
  catch (error) { await rm(temporary, { force: true }).catch(() => {}); throw error; }
  return { available: true, summary };
}
function runSummary(filePath, force) {
  const existing = summaryJobs.get(filePath);
  if (existing) return existing.promise;
  const controller = new AbortController();
  const promise = (async () => {
    try {
      if (!force) {
        const saved = await loadSummary(filePath);
        if (saved.available || saved.error) return saved;
      }
      return await generateSummary(filePath, controller);
    } catch (error) { return { error: controller.signal.aborted ? 'Создание сводки отменено или превышено время ожидания.' : error.message }; }
    finally { summaryJobs.delete(filePath); }
  })();
  summaryJobs.set(filePath, { controller, promise });
  return promise;
}

function obsidianArticlePath(filePath) {
  return path.join(appSettings.storage.obsidianInbox, `${safeNoteName(`Сводка — ${path.parse(filePath).name}`)}.md`);
}

async function exportSummaryToObsidian(filePath, duration, mode = 'create') {
  await validateNotesVideo(filePath);
  const saved = await loadSummary(filePath);
  if (saved.error) throw new Error(saved.error);
  if (!saved.available) throw new Error('Сначала создайте актуальную сводку.');
  const inbox = appSettings.storage.obsidianInbox;
  const name = path.parse(filePath).name;
  const noteName = safeNoteName(`Сводка — ${name}`);
  if (mode === 'append') {
    const target = obsidianArticlePath(filePath);
    const existing = await readFile(target, 'utf8').catch(() => null);
    if (existing !== null) {
      const addendum = buildObsidianAddendum({ videoPath: filePath, summary: saved.summary, date: new Date().toLocaleString('ru-RU') });
      const temporary = `${target}.${process.pid}.tmp`;
      try { await writeFile(temporary, `${existing.trimEnd()}\n${addendum}`, 'utf8'); await rename(temporary, target); }
      catch (error) { await rm(temporary, { force: true }).catch(() => {}); throw error; }
      return { path: target, frames: 0, warning: '', appended: true };
    }
  }
  const imagePrefix = `${safeNoteName(name)}_${transcriptKey(filePath)}`;
  const assetsDirectory = path.join(inbox, 'images');
  await mkdir(assetsDirectory, { recursive: true });
  const imageName = index => `${imagePrefix}_${String(index + 1).padStart(2, '0')}.jpg`;
  for (let index = 0; index < FRAME_COUNT; index++) await rm(path.join(assetsDirectory, imageName(index)), { force: true });
  const frames = [];
  let warning = '';
  if (Number.isFinite(duration) && duration > 0) {
    for (const [index, time] of frameTimes(duration).entries()) {
      const fileName = imageName(index);
      try {
        await runFfmpeg(['-v', 'error', '-nostdin', '-ss', time.toFixed(3), '-i', filePath, '-an', '-sn', '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', '-y', path.join(assetsDirectory, fileName)], () => {});
        frames.push({ time, width: 180, file: fileName });
      } catch (error) {
        if (error.code === 'ENOENT') { warning = 'FFmpeg не найден в PATH: статья создана без миниатюр.'; break; }
        warning = 'Часть миниатюр не удалось получить.';
      }
    }
  } else warning = 'Длительность видео неизвестна: статья создана без миниатюр.';
  const article = buildObsidianArticle({ title: name, videoPath: filePath, duration, summary: saved.summary, frames });
  const target = path.join(inbox, `${noteName}.md`);
  const temporary = `${target}.${process.pid}.tmp`;
  try { await writeFile(temporary, article, 'utf8'); await rename(temporary, target); }
  catch (error) { await rm(temporary, { force: true }).catch(() => {}); throw error; }
  return { path: target, frames: frames.length, warning };
}

function speedUpCodecArguments(extension) { return reencodeCodecArguments(extension); }

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

function createWindowsShortcut(targetPath, shortcutPath) {
  const command = '$shell = New-Object -ComObject WScript.Shell; $shortcut = $shell.CreateShortcut($env:FOLDER_VIDEO_SHORTCUT_PATH); $shortcut.TargetPath = $env:FOLDER_VIDEO_SHORTCUT_TARGET; $shortcut.WorkingDirectory = Split-Path -Parent $env:FOLDER_VIDEO_SHORTCUT_TARGET; $shortcut.Save()';
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true,
      env: { ...process.env, FOLDER_VIDEO_SHORTCUT_TARGET: targetPath, FOLDER_VIDEO_SHORTCUT_PATH: shortcutPath }
    });
    let stderr = '';
    child.once('error', reject);
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('close', code => code === 0 ? resolve() : reject(new Error(stderr || 'Не удалось создать ярлык')));
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
    // Версия в запросе: после замены файла (вырезка, отмена) Chromium не должен брать байты из кэша по прежнему адресу.
    url: `${pathToFileURL(filePath).href}?v=${stat.size}-${Math.round(stat.mtimeMs)}`,
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
        if (recursive && entry.name !== UNDO_DIRECTORY) await walk(entryPath);
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

ipcMain.handle('folder-video:open-in-okoshko', async (_event, filePath) => {
  if (typeof filePath !== 'string') return 'Invalid video path';
  const exe = path.join(process.env.LOCALAPPDATA || '', 'okoshko', 'okoshko.exe');
  try { await lstat(exe); } catch { return 'okoshko.exe не найден: ' + exe; }
  return new Promise(resolve => {
    const child = spawn(exe, [filePath], { detached: true, stdio: 'ignore' });
    child.once('error', error => resolve(error.message));
    child.once('spawn', () => { child.unref(); resolve(''); });
  });
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

ipcMain.handle('folder-video:create-file-shortcut', async (event, filePath) => {
  if (process.platform !== 'win32' || typeof filePath !== 'string') return { error: 'Создание ярлыков поддерживается только в Windows' };
  try {
    if (!(await lstat(filePath)).isFile()) return { error: 'Видео не найдено' };
  } catch { return { error: 'Видео не найдено' }; }
  const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
    title: 'Выберите папку для ярлыка', properties: ['openDirectory']
  });
  if (result.canceled) return { canceled: true };
  const directory = result.filePaths[0];
  const shortcutName = path.basename(filePath);
  let shortcutPath = path.join(directory, `${shortcutName}.lnk`);
  for (let index = 2; ; index += 1) {
    try { await lstat(shortcutPath); shortcutPath = path.join(directory, `${shortcutName} (${index}).lnk`); } catch (error) {
      if (error.code === 'ENOENT') break;
      return { error: `Не удалось проверить папку: ${error.message}` };
    }
  }
  try {
    await createWindowsShortcut(filePath, shortcutPath);
    return { success: true, shortcutPath };
  } catch (error) { return { error: error.message || 'Не удалось создать ярлык' }; }
});

ipcMain.handle('folder-video:parent-folder', async (_event, filePath) => {
  if (typeof filePath !== 'string') return null;
  try {
    const stat = await lstat(filePath);
    return stat.isFile() ? path.dirname(filePath) : null;
  } catch {
    return null;
  }
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
function isSupportedVideoPath(filePath) { return typeof filePath === 'string' && VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase()); }

function runSearchTool(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true }); let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Превышено время ожидания поиска')); }, 30000);
    child.stdout.on('data', chunk => { output += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error('yt-dlp завершился с кодом ' + code)); });
  });
}

async function searchYouTube(query) {
  try {
    const candidates = youtubeLink.parseYtDlpOutput(await runSearchTool('yt-dlp', ['--flat-playlist', '--dump-json', '--no-warnings', 'ytsearch' + youtubeLink.MAX_CANDIDATES + ':' + query]));
    if (candidates.length) return candidates;
  } catch { /* yt-dlp нет в PATH или он не справился — разбираем страницу поиска */ }
  const response = await fetch('https://www.youtube.com/results?hl=ru&search_query=' + encodeURIComponent(query), {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Accept-Language': 'ru,en;q=0.8', Cookie: 'CONSENT=YES+1; SOCS=CAI' },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error('YouTube ответил кодом ' + response.status);
  return youtubeLink.parseSearchHtml(await response.text());
}

ipcMain.handle('folder-video:youtube-read', async (_event, filePath) => {
  try {
    if (!isSupportedVideoPath(filePath)) return { error: 'Неподдерживаемый файл' };
    if (!youtubeLink.isWritableExtension(path.extname(filePath))) return { supported: false, url: '' };
    const result = await readAuthorUrl(filePath);
    return { supported: result.supported, url: youtubeLink.isYouTubeVideoUrl(result.url) ? result.url : '', rawUrl: result.url };
  } catch (error) { return { error: error.message }; }
});
ipcMain.handle('folder-video:youtube-search', async (_event, filePath, durationSeconds) => {
  try {
    if (!isSupportedVideoPath(filePath)) return { error: 'Неподдерживаемый файл' };
    const query = youtubeLink.cleanSearchTitle(path.basename(filePath));
    if (!query) return { error: 'Не удалось получить название для поиска' };
    const candidates = await searchYouTube(query);
    return { query, candidates, auto: youtubeLink.pickAutoCandidate(candidates, Number(durationSeconds)) };
  } catch (error) { return { error: error.message }; }
});
ipcMain.handle('folder-video:youtube-write', async (_event, filePath, url) => {
  try {
    if (!isSupportedVideoPath(filePath) || !youtubeLink.isWritableExtension(path.extname(filePath))) return { error: 'Формат не поддерживает запись свойства' };
    if (!youtubeLink.isYouTubeVideoUrl(url)) return { error: 'Некорректная ссылка YouTube' };
    const result = await writeAuthorUrl(filePath, url);
    return { url: result.url, warning: result.datesIntact ? '' : 'Не удалось полностью сохранить даты файла' };
  } catch (error) { return { error: error.message }; }
});
ipcMain.handle('folder-video:youtube-open', async (_event, url) => {
  if (!youtubeLink.isYouTubeVideoUrl(url)) return 'Некорректная ссылка';
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

ipcMain.handle('folder-video:move-file', async (event, sourcePath) => {
  if (typeof sourcePath !== 'string') return { error: 'Invalid path' };
  const result = await dialog.showOpenDialog({
    title: 'Выберите папку для перемещения',
    properties: ['openDirectory']
  });
  if (result.canceled) return { canceled: true };
  const dest = path.join(result.filePaths[0], path.basename(sourcePath));

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

  const sameFileConflict = createSameFileMoveConflict(sourcePath, dest);
  if (sameFileConflict) {
    const confirmation = await dialog.showMessageBox(
      BrowserWindow.fromWebContents(event.sender),
      sameFileConflict.dialogOptions
    );
    if (confirmation.response !== 0) return { canceled: true };
    return sameFileConflict.confirmedResult;
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
    for (let attempt = 0; attempt < 12; attempt += 1) {
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
        if (attempt < 11) await new Promise(resolve => setTimeout(resolve, 250));
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

// --- Вырезка фрагментов ---
const CUT_BACKUP_DAYS = 7;
let cutUndoStore;
let cutJob = null;
function openCutUndoStore() { cutUndoStore = new CutUndoStore(path.join(app.getPath('userData'), 'cut-backups.json')); cutUndoStore.prune(CUT_BACKUP_DAYS * 24 * 3600 * 1000).catch(() => {}); }

async function validateCutSource(filePath) {
  if (typeof filePath !== 'string' || !VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase())) throw new Error('Некорректный путь к видео');
  const info = await lstat(filePath);
  if (!info.isFile()) throw new Error('Указанный путь не является файлом');
}
function cleanRanges(ranges) {
  if (!Array.isArray(ranges) || ranges.length > 500) throw new Error('Некорректный список фрагментов');
  return ranges.map(range => ({ start: Number(range && range.start), end: Number(range && range.end) }));
}
async function uniqueCutOutput(filePath) {
  const parsed = path.parse(filePath);
  for (let index = 1; ; index++) {
    const candidate = path.join(parsed.dir, `${parsed.name} (cut${index > 1 ? ` ${index}` : ''})${parsed.ext}`);
    try { await lstat(candidate); } catch (error) { if (error.code === 'ENOENT') return candidate; throw error; }
  }
}

// Ключевые кадры читаются долго на больших файлах, поэтому запоминаем последние результаты.
const keyframeCache = new Map();
async function cachedKeyframes(filePath) {
  const info = await lstat(filePath);
  const key = `${filePath}|${info.size}|${info.mtimeMs}`;
  if (!keyframeCache.has(key)) {
    keyframeCache.set(key, await listKeyframes(filePath));
    if (keyframeCache.size > 5) keyframeCache.delete(keyframeCache.keys().next().value);
  }
  return keyframeCache.get(key);
}

ipcMain.handle('folder-video:cut-plan', async (_event, filePath, ranges, precise) => {
  try {
    await validateCutSource(filePath);
    const duration = await probeDuration(filePath);
    const plan = await planCut({ sourcePath: filePath, ranges: cleanRanges(ranges), duration, precise: Boolean(precise), keyframes: precise ? undefined : await cachedKeyframes(filePath).catch(() => undefined) });
    return { plan };
  } catch (error) { return { error: error.message || 'Не удалось подготовить вырезку', code: error.code }; }
});

ipcMain.handle('folder-video:cut-start', async (event, filePath, operationId, ranges, precise) => {
  if (typeof operationId !== 'string' || !operationId) return { error: 'Некорректная операция' };
  if (cutJob) return { error: 'Вырезка уже выполняется' };
  const replaceOriginal = appSettings.cut ? appSettings.cut.replaceOriginal !== false : true;
  const sendProgress = percent => { if (!event.sender.isDestroyed()) event.sender.send('folder-video:cut-progress', { operationId, percent: Math.round(percent) }); };
  const job = { operationId, cancel: () => {} };
  cutJob = job;
  let temporary = null;
  try {
    await validateCutSource(filePath);
    const duration = await probeDuration(filePath);
    const plan = await planCut({ sourcePath: filePath, ranges: cleanRanges(ranges), duration, precise: Boolean(precise), keyframes: precise ? undefined : await cachedKeyframes(filePath).catch(() => undefined) });
    temporary = `${filePath}.fv-cut-${Date.now()}.tmp`;
    sendProgress(0);
    const run = executeCut({ sourcePath: filePath, outputPath: temporary, plan, onProgress: sendProgress });
    job.cancel = run.cancel;
    const executed = await run.promise;
    if (!replaceOriginal) {
      const outputPath = await uniqueCutOutput(filePath);
      await rename(temporary, outputPath);
      temporary = null;
      sendProgress(100);
      return { success: true, outputPath, replaced: false, duration: executed.duration, ranges: plan.ranges, skipped: plan.skipped };
    }
    const oldHash = await hashFile(filePath).catch(() => null);
    const notesFile = notesPath(filePath);
    await (notesSaveJobs.get(filePath) || Promise.resolve()).catch(() => {});
    const entry = await cutUndoStore.commit({ sourcePath: filePath, tempPath: temporary, sidecars: [notesFile], ranges: plan.ranges, precise: plan.precise });
    temporary = null;
    try {
      const notes = await readFile(notesFile, 'utf8');
      const shifted = shiftNotes(notes, plan.ranges);
      if (shifted !== notes) { if (shifted) await writeFile(notesFile, shifted, 'utf8'); else await rm(notesFile, { force: true }); }
    } catch (error) { if (error.code !== 'ENOENT') console.error('Не удалось пересчитать заметки:', error.message); }
    if (oldHash) hashFile(filePath).then(newHash => newHash !== oldHash ? metadataStore.copy(oldHash, newHash, path.basename(filePath)) : null).catch(() => {});
    sendProgress(100);
    return { success: true, outputPath: filePath, replaced: true, undoId: entry.id, duration: executed.duration, ranges: plan.ranges, skipped: plan.skipped };
  } catch (error) {
    if (temporary) await rm(temporary, { force: true }).catch(() => {});
    return error.code === 'ECANCELED' ? { canceled: true } : { error: error.message || 'Не удалось вырезать фрагменты', code: error.code };
  } finally { if (cutJob === job) cutJob = null; }
});
ipcMain.handle('folder-video:cut-cancel', (_event, operationId) => { if (cutJob && cutJob.operationId === operationId) { cutJob.cancel(); return true; } return false; });
// Звуковая волна для полосы вырезки: первая звуковая дорожка, моно 8 кГц, пики по 2,5 мс. Результат кэшируется.
const waveformCache = new Map();
function computeWaveform(filePath) {
  return new Promise((resolve, reject) => {
    const collector = new PeakCollector();
    let stderr = '';
    const child = spawn('ffmpeg', ['-v', 'error', '-i', filePath, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', 'pipe:1'], { windowsHide: true });
    child.once('error', reject);
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-1000); });
    child.stdout.on('data', chunk => collector.push(chunk));
    child.once('close', code => {
      const peaks = collector.result();
      if (code === 0 || peaks.length) resolve({ binsPerSecond: BINS_PER_SECOND, peaks: Buffer.from(peaks.buffer, peaks.byteOffset, peaks.length) });
      else resolve({ none: true, reason: stderr.trim() });
    });
  });
}
ipcMain.handle('folder-video:cut-waveform', async (_event, filePath) => {
  try {
    await validateCutSource(filePath);
    const info = await lstat(filePath);
    const key = `${filePath}|${info.size}|${info.mtimeMs}`;
    if (!waveformCache.has(key)) {
      waveformCache.set(key, computeWaveform(filePath));
      if (waveformCache.size > 3) waveformCache.delete(waveformCache.keys().next().value);
    }
    return await waveformCache.get(key);
  } catch (error) {
    return { error: error.code === 'ENOENT' ? 'FFmpeg не найден в PATH.' : (error.message || 'Не удалось построить волну') };
  }
});
ipcMain.handle('folder-video:cut-undo', async (_event, undoId) => {
  try { const entry = await cutUndoStore.undo(String(undoId)); return { success: true, outputPath: entry.sourcePath }; }
  catch (error) { return { error: error.message || 'Не удалось отменить вырезку' }; }
});
ipcMain.handle('folder-video:cut-list-backups', async () => { try { return { backups: await cutUndoStore.list() }; } catch (error) { return { error: error.message }; } });
ipcMain.handle('folder-video:cut-clear-backups', async () => { try { return { removed: await cutUndoStore.clear() }; } catch (error) { return { error: error.message }; } });

ipcMain.handle('folder-video:transcript-load', async (_event, filePath) => loadTranscript(filePath));
ipcMain.handle('folder-video:transcript-start', async (event, filePath, operationId) => {
  if (typeof operationId !== 'string' || !operationId) return { error: 'Некорректная операция' };
  if (transcriptJobs.has(operationId)) return { error: 'Транскрибация уже выполняется' };
  return runTranscript(event, filePath, operationId);
});
ipcMain.handle('folder-video:transcript-cancel', async (_event, operationId) => {
  const job = transcriptJobs.get(operationId);
  if (!job) return { canceled: false };
  cancelTranscriptJob(job);
  return { canceled: true };
});
ipcMain.handle('folder-video:summary-load', async (_event, filePath) => loadSummary(filePath));
ipcMain.handle('folder-video:summary-start', async (_event, filePath, force = false) => {
  if (typeof filePath !== 'string' || !VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return { error: 'Некорректный путь к видео' };
  return runSummary(filePath, force === true);
});
ipcMain.handle('folder-video:summary-cancel', (_event, filePath) => {
  const job = summaryJobs.get(filePath);
  if (!job) return { canceled: false };
  job.controller.abort();
  return { canceled: true };
});
ipcMain.handle('folder-video:summary-obsidian-path', async (_event, filePath) => {
  if (typeof filePath !== 'string') return { exists: false };
  const target = obsidianArticlePath(filePath);
  const exists = await lstat(target).then(stat => stat.isFile(), () => false);
  return { exists, path: target };
});
ipcMain.handle('folder-video:summary-export-obsidian', async (_event, filePath, duration, mode) => {
  if (typeof filePath !== 'string') return { error: 'Некорректный путь к видео' };
  if (obsidianJobs.has(filePath)) return { error: 'Статья для этого видео уже создаётся.' };
  obsidianJobs.add(filePath);
  try { return await exportSummaryToObsidian(filePath, Number(duration), mode === 'append' ? 'append' : 'create'); }
  catch (error) { return { error: error.message || 'Не удалось создать статью' }; }
  finally { obsidianJobs.delete(filePath); }
});
ipcMain.handle('folder-video:notes-load', async (_event, filePath) => loadNotes(filePath));
ipcMain.handle('folder-video:notes-save', async (_event, filePath, text) => saveNotes(filePath, text));

ipcMain.handle('folder-video:set-title', (event, folderPath) => {
  const title = typeof folderPath === 'string' && folderPath
    ? `${APP_TITLE} (${folderPath})`
    : APP_TITLE;
  BrowserWindow.fromWebContents(event.sender)?.setTitle(title);
});

ipcMain.handle('folder-video:get-app-info', () => ({ version: APP_VERSION }));
ipcMain.handle('folder-video:check-update', () => checkForUpdate(true));
ipcMain.handle('folder-video:get-update-state', () => updateState);
ipcMain.handle('folder-video:update-ready', (event, id, error) => {
  if (updatePreparation?.id === id && updatePreparation.sender === event.sender) updatePreparation.finish(typeof error === 'string' ? error : null);
});
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
  if (app.isPackaged) app.setAsDefaultProtocolClient('folder-video');
  const launchTarget = await getLaunchTarget(process.argv);
  if (launchTarget?.type === 'play') {
    await playInSystemPlayer(launchTarget);
    app.quit();
    return;
  }
  await loadSettings();
  openMetadataStore();
  openCutUndoStore();
  createWindow();
  const updateTimer = setTimeout(() => { if (appSettings.autoUpdate) void checkForUpdate(false); }, 10000);
  updateTimer.unref();
  openLaunchTarget(process.argv);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
