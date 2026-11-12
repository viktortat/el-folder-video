"use strict";
// Общее окружение распознавания: transcribe.dll и модель GGUF. Папка окружения общая для всех приложений
// (спецификация: docs/transcript-store.md); у Folder-video запасной вариант — библиотека из собственной сборки.
const { app, net } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MODEL_FILE = 'parakeet-tdt-0.6b-v3-Q8_0.gguf';
const MODEL_URL = 'https://huggingface.co/handy-computer/parakeet-tdt-0.6b-v3-gguf/resolve/main/parakeet-tdt-0.6b-v3-Q8_0.gguf';
const RUNTIME_URL = 'https://github.com/handy-computer/transcribe.cpp/releases/download/v0.2.3/transcribe-native-0.2.3-windows-x86_64-cpu-vulkan.tar.gz';
const NATIVE_DIR = 'transcribe-native-windows-x86_64-cpu-vulkan';
const LIBRARY_NAME = process.platform === 'darwin' ? 'libtranscribe.dylib' : 'transcribe.dll';
const DLL_REL = path.join('tools', 'transcribe-cpp', NATIVE_DIR, LIBRARY_NAME);
const MIN_MODEL_BYTES = 50 * 1024 * 1024;
const MIN_RUNTIME_BYTES = 1024 * 1024;

function isFile(filePath) {
  try { return fs.statSync(filePath).isFile(); } catch { return false; }
}

function defaultEnvironmentDirectory() {
  return path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'transcribe-shared');
}

function environmentDirectory(settings) {
  const value = settings?.transcription?.environmentDirectory;
  return typeof value === 'string' && value.trim() ? path.resolve(value) : defaultEnvironmentDirectory();
}

function bundledLibrary() {
  const root = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..', 'tools', 'transcribe-cpp');
  return path.join(root, NATIVE_DIR, LIBRARY_NAME);
}

function modelsDirectory(settings) { return path.join(environmentDirectory(settings), 'models'); }

function huggingFaceModel() {
  const root = path.join(os.homedir(), '.cache', 'huggingface', 'hub', 'models--handy-computer--parakeet-tdt-0.6b-v3-gguf', 'snapshots');
  try {
    for (const snapshot of fs.readdirSync(root)) {
      const candidate = path.join(root, snapshot, MODEL_FILE);
      if (isFile(candidate)) return candidate;
    }
  } catch { /* кэша нет */ }
  return '';
}

function environmentModel(settings) {
  const directory = modelsDirectory(settings);
  const preferred = path.join(directory, MODEL_FILE);
  if (isFile(preferred)) return preferred;
  try {
    const other = fs.readdirSync(directory).find(name => name.toLowerCase().endsWith('.gguf'));
    return other ? path.join(directory, other) : '';
  } catch { return ''; }
}

function libraryPath(settings) {
  for (const candidate of [path.join(environmentDirectory(settings), DLL_REL), bundledLibrary()]) if (isFile(candidate)) return candidate;
  return '';
}

// Модель: файл из настроек → окружение → кэш HuggingFace.
function environmentStatus(settings) {
  const explicit = settings?.transcription?.modelPath || '';
  const candidates = [['settings', explicit], ['environment', environmentModel(settings)], ['huggingface', huggingFaceModel()]];
  const library = libraryPath(settings);
  for (const [source, candidate] of candidates) {
    if (candidate && isFile(candidate)) return { modelFound: true, modelPath: candidate, modelSource: source, libraryFound: Boolean(library), libraryPath: library, directory: environmentDirectory(settings) };
  }
  return { modelFound: false, modelPath: '', modelSource: null, libraryFound: Boolean(library), libraryPath: library, directory: environmentDirectory(settings) };
}

async function fetchToFile(url, destination, minBytes, signal, onProgress) {
  const partial = `${destination}.part`;
  let output = null;
  try {
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    const response = await net.fetch(url, { signal, redirect: 'follow' });
    if (!response.ok || !response.body) return `Сервер ответил ${response.status} ${response.statusText}`.trim();
    const total = Number(response.headers.get('content-length')) || 0;
    output = fs.createWriteStream(partial);
    let received = 0;
    let last = -1;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (!output.write(value)) await new Promise(resolve => output.once('drain', resolve));
      const percent = total ? Math.min(99, Math.floor(received / total * 100)) : 0;
      if (percent !== last) onProgress(last = percent);
    }
    await new Promise((resolve, reject) => output.end(error => error ? reject(error) : resolve()));
    output = null;
    if (received < minBytes) return 'Скачанный файл слишком маленький: проверьте ссылку.';
    await fs.promises.rename(partial, destination);
    return null;
  } catch (error) {
    if (signal.aborted) throw error;
    return error.message || String(error);
  } finally {
    output?.destroy();
    await fs.promises.rm(partial, { force: true }).catch(() => {});
  }
}

function untar(archive, into) {
  return new Promise(resolve => {
    const child = spawn('tar', ['-xzf', archive, '-C', into], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-500); });
    child.once('error', error => resolve(`Не удалось запустить tar: ${error.message}`));
    child.once('close', code => resolve(code === 0 ? null : stderr.trim() || `tar завершился с кодом ${code}`));
  });
}

let downloadController = null;

function cancelDownload() { downloadController?.abort(); }
function isDownloading() { return Boolean(downloadController); }

// kind: 'model' | 'library'. Возвращает { success } | { error } | { canceled }.
async function downloadEnvironment(settings, kind, onProgress) {
  if (downloadController) return { error: 'Что-то уже скачивается' };
  const controller = downloadController = new AbortController();
  try {
    if (kind === 'model') {
      const target = path.join(modelsDirectory(settings), MODEL_FILE);
      const error = await fetchToFile(MODEL_URL, target, MIN_MODEL_BYTES, controller.signal, onProgress);
      if (error) return { error: `Не удалось скачать модель: ${error}` };
      onProgress(100);
      return { success: true, path: target };
    }
    const directory = path.join(environmentDirectory(settings), 'tools', 'transcribe-cpp');
    const archive = path.join(directory, 'transcribe-native.tar.gz');
    const error = await fetchToFile(RUNTIME_URL, archive, MIN_RUNTIME_BYTES, controller.signal, onProgress);
    if (error) return { error: `Не удалось скачать библиотеку: ${error}` };
    const unpackError = await untar(archive, directory);
    await fs.promises.rm(archive, { force: true });
    if (unpackError) return { error: `Не удалось распаковать архив: ${unpackError}` };
    const library = path.join(environmentDirectory(settings), DLL_REL);
    if (!isFile(library)) return { error: `В архиве нет ${NATIVE_DIR}\\${LIBRARY_NAME}: проверьте ссылку.` };
    onProgress(100);
    return { success: true, path: library };
  } catch {
    return { canceled: true };
  } finally {
    if (downloadController === controller) downloadController = null;
  }
}

module.exports = { environmentDirectory, defaultEnvironmentDirectory, environmentStatus, downloadEnvironment, cancelDownload, isDownloading, DLL_REL, MODEL_FILE };
