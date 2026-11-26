// Список каталога сразу с размерами и датами.
// В Windows lstat открывает каждый файл (на 18 000 видео это около 7 секунд), а FindFirstFileExW отдаёт
// имя, атрибуты, размер и даты за один проход по каталогу. На других системах и при сбое — readdir + lstat.
const path = require('node:path');
const { readdir, lstat } = require('node:fs/promises');

const ATTRIBUTE_DIRECTORY = 0x10;
const ATTRIBUTE_DEVICE = 0x40;
const ATTRIBUTE_REPARSE_POINT = 0x400;
const FIND_DATA_SIZE = 592; // WIN32_FIND_DATAW
const INFO_BASIC = 1;
const SEARCH_NAME_MATCH = 0;
const LARGE_FETCH = 2;
const ERROR_NO_MORE_FILES = 18;
const FILETIME_UNIX_EPOCH = 116444736000000000n;
const YIELD_EVERY = 2000;
// Пока файл пишется, NTFS обновляет запись каталога с опозданием: свежие файлы перепроверяются через lstat.
const FRESH_MS = 60 * 60 * 1000;
const STAT_CONCURRENCY = 16;

function loadWindowsApi() {
  if (process.platform !== 'win32') return null;
  try {
    const koffi = require('koffi');
    const kernel32 = koffi.load('kernel32.dll');
    return {
      first: kernel32.func('intptr_t __stdcall FindFirstFileExW(str16 name, int level, void *data, int search, void *filter, uint32_t flags)'),
      next: kernel32.func('int __stdcall FindNextFileW(intptr_t handle, void *data)'),
      close: kernel32.func('int __stdcall FindClose(intptr_t handle)'),
      lastError: kernel32.func('uint32_t __stdcall GetLastError()')
    };
  } catch (error) {
    console.warn('Быстрое чтение каталогов недоступно:', error.message);
    return null;
  }
}

const windowsApi = loadWindowsApi();

function fileTimeToMs(data, offset) {
  const ticks = data.readBigUInt64LE(offset) - FILETIME_UNIX_EPOCH;
  return Number(ticks / 10000n) + Number(ticks % 10000n) / 10000;
}

function parseFindData(data) {
  let end = 44;
  while (end < 564 && data.readUInt16LE(end) !== 0) end += 2;
  const attributes = data.readUInt32LE(0);
  const isLink = (attributes & ATTRIBUTE_REPARSE_POINT) !== 0;
  const isDevice = (attributes & ATTRIBUTE_DEVICE) !== 0;
  const isDirectory = !isLink && !isDevice && (attributes & ATTRIBUTE_DIRECTORY) !== 0;
  return {
    name: data.toString('utf16le', 44, end),
    isDirectory,
    isFile: !isLink && !isDevice && !isDirectory,
    isSymbolicLink: isLink,
    createdMs: fileTimeToMs(data, 4),
    stat: { size: data.readUInt32LE(28) * 0x100000000 + data.readUInt32LE(32), mtimeMs: fileTimeToMs(data, 20) }
  };
}

// null — каталог нужно прочитать обычным способом (он же сообщит об ошибке доступа).
async function listWindows(directory, wanted) {
  const data = Buffer.alloc(FIND_DATA_SIZE);
  const root = path.toNamespacedPath(path.resolve(directory));
  const pattern = root.endsWith(path.sep) ? `${root}*` : `${root}${path.sep}*`;
  // Первый вызов асинхронный: диск может «просыпаться», а главный процесс не должен замирать.
  const handle = await new Promise((resolve, reject) => {
    windowsApi.first.async(pattern, INFO_BASIC, data, SEARCH_NAME_MATCH, null, LARGE_FETCH, (error, result) => error ? reject(error) : resolve(result));
  });
  if (Number(handle) === -1) return null;
  const entries = [];
  try {
    let count = 0;
    do {
      const entry = parseFindData(data);
      if (entry.name !== '.' && entry.name !== '..' && (entry.isDirectory || entry.isSymbolicLink || wanted(entry.name))) entries.push(entry);
      if (++count % YIELD_EVERY === 0) await new Promise(setImmediate);
    } while (windowsApi.next(handle, data));
    if (windowsApi.lastError() !== ERROR_NO_MORE_FILES && count === 0) return null;
  } finally {
    windowsApi.close(handle);
  }
  return entries;
}

async function listPortable(directory, wanted) {
  const dirents = await readdir(directory, { withFileTypes: true });
  return dirents
    .map(dirent => ({ name: dirent.name, isDirectory: dirent.isDirectory(), isFile: dirent.isFile(), isSymbolicLink: dirent.isSymbolicLink(), stat: null }))
    .filter(entry => entry.isDirectory || entry.isSymbolicLink || wanted(entry.name));
}

async function fillStats(directory, entries) {
  let index = 0;
  async function worker() {
    while (index < entries.length) {
      const entry = entries[index++];
      try {
        const { size, mtimeMs } = await lstat(path.join(directory, entry.name));
        entry.stat = { size, mtimeMs };
      } catch {
        entry.stat = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(STAT_CONCURRENCY, entries.length) }, worker));
}

/**
 * Записи каталога: подпапки, ссылки и файлы, прошедшие `wanted(name)`.
 * У файла `stat` = { size, mtimeMs }; null — свойства прочитать не удалось.
 * Ошибка чтения самого каталога выбрасывается.
 */
async function listDirectory(directory, wanted) {
  const fast = windowsApi ? await listWindows(directory, wanted) : null;
  const entries = fast || await listPortable(directory, wanted);
  const freshAfter = Date.now() - FRESH_MS;
  await fillStats(directory, entries.filter(entry => entry.isFile && (!entry.stat || entry.stat.mtimeMs > freshAfter || entry.createdMs > freshAfter)));
  return entries;
}

module.exports = { listDirectory, isFastListingAvailable: Boolean(windowsApi) };
