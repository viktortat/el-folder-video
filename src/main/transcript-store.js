"use strict";
// Файлы общего хранилища транскрипций (спецификация: docs/transcript-store.md).
const { readFile, writeFile, rename, rm, mkdir, readdir, lstat, copyFile, unlink } = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const core = require('../shared/transcript-store-core');

const APP_NAMES = { 'folder-video': 'Folder-video', okoshko: 'Окошко', 'youtube-radar': 'YouTube Radar' };
const STORE_FILE = /\.(srt|txt|json|notes\.md|summary\.json|lock|ru\.srt|ru\.txt)$/i;

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

function youtubeIdFromUrl(value) {
  try {
    const url = new URL(value);
    const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v');
    return core.isYoutubeId(id) ? id : '';
  } catch { return ''; }
}

function createTranscriptStore({ getDirectory, appId = 'folder-video' }) {
  const pathHash = filePath => createHash('sha256').update(filePath).digest('hex');
  const stemFor = filePath => core.fileStem(filePath, pathHash(filePath));

  function paths(filePath) {
    const directory = getDirectory();
    const stem = stemFor(filePath);
    return pathsForStem(directory, stem);
  }
  function pathsForStem(directory, stem) {
    const base = path.join(directory, stem);
    return { directory, stem, srtPath: `${base}.srt`, txtPath: `${base}.txt`, manifestPath: `${base}.json`, lockPath: `${base}.lock`, notesPath: `${base}.notes.md`, summaryPath: `${base}.summary.json` };
  }
  const youtubePaths = id => pathsForStem(getDirectory(), core.youtubeStem(id));

  async function atomicWrite(target, data) {
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    try { await writeFile(temporary, data, typeof data === 'string' ? 'utf8' : undefined); await rename(temporary, target); }
    catch (error) { await rm(temporary, { force: true }).catch(() => {}); throw error; }
  }

  const signatureOf = (filePath, stat) => ({ filePath, size: stat.size, mtimeMs: stat.mtimeMs });

  // Транскрипция самого видео: { available, srt, srtPath } | { available: false, stale? } | { error }.
  async function readOwn(filePath, stat) {
    const p = paths(filePath);
    try {
      const manifest = JSON.parse(await readFile(p.manifestPath, 'utf8'));
      if (!core.isTranscriptFresh(manifest, signatureOf(filePath, stat))) return { available: false, stale: true };
      return { available: true, srt: await readFile(p.srtPath, 'utf8'), srtPath: p.srtPath, stem: p.stem };
    } catch (error) {
      return error.code === 'ENOENT' ? { available: false } : { error: `Не удалось открыть транскрипцию: ${error.message}` };
    }
  }

  // Транскрипция ролика YouTube, привязанного к файлу (только чтение).
  async function readYoutube(id) {
    const p = youtubePaths(id);
    try { return { available: true, srt: await readFile(p.srtPath, 'utf8'), srtPath: p.srtPath, stem: p.stem, fromYoutube: true, youtubeId: id }; }
    catch { return { available: false }; }
  }

  // linkedUrl — ссылка YouTube, привязанная к видео; без собственной транскрипции показывается транскрипция ролика.
  async function read(filePath, stat, linkedUrl) {
    const own = await readOwn(filePath, stat);
    if (own.available || own.error || !linkedUrl) return own;
    const id = youtubeIdFromUrl(linkedUrl);
    if (!id) return own;
    const shared = await readYoutube(id);
    return shared.available ? shared : own;
  }

  async function write(filePath, stat, segments, model) {
    const p = paths(filePath);
    const manifest = core.buildManifest({ source: core.fileManifestSource(signatureOf(filePath, stat)), model, createdBy: appId });
    const text = segments.map(segment => segment.text).join('\n');
    await atomicWrite(p.srtPath, core.toSrt(segments));
    await atomicWrite(p.txtPath, `${text}\n`);
    await atomicWrite(p.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return p;
  }

  // Lock транскрибации: { release } или { error }. Устаревший lock (процесса нет или прошло 6 часов) снимается.
  async function acquireLock(filePath) {
    const p = paths(filePath);
    await mkdir(p.directory, { recursive: true });
    const content = `${JSON.stringify(core.buildLock({ app: appId, pid: process.pid }))}\n`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await writeFile(p.lockPath, content, { flag: 'wx' });
        return { release: () => rm(p.lockPath, { force: true }).catch(() => {}) };
      } catch (error) {
        if (error.code !== 'EEXIST') return { error: `Не удалось создать lock: ${error.message}` };
        let lock = null;
        try { lock = JSON.parse(await readFile(p.lockPath, 'utf8')); } catch { /* повреждён — считаем устаревшим */ }
        if (!core.isLockStale(lock, Date.now(), pidAlive)) return { error: `Транскрибация уже идёт в ${APP_NAMES[lock.app] || lock.app}.` };
        await rm(p.lockPath, { force: true });
      }
    }
    return { error: 'Не удалось получить lock транскрибации.' };
  }

  // Файлы хранилища в папке (для переноса при смене папки).
  async function listStoreFiles(directory) {
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      return entries.filter(entry => entry.isFile() && STORE_FILE.test(entry.name) && !entry.name.endsWith('.lock')).map(entry => entry.name);
    } catch { return []; }
  }

  // Переносит файлы хранилища; существующие в целевой папке не перезаписываются.
  async function moveStoreFiles(from, to) {
    const result = { moved: 0, skipped: 0, failed: 0 };
    if (path.resolve(from).toLowerCase() === path.resolve(to).toLowerCase()) return result;
    await mkdir(to, { recursive: true });
    for (const name of await listStoreFiles(from)) {
      const source = path.join(from, name);
      const target = path.join(to, name);
      if (await lstat(target).then(() => true, () => false)) { result.skipped++; continue; }
      try {
        try { await rename(source, target); }
        catch (error) {
          if (error.code !== 'EXDEV') throw error;
          await copyFile(source, target);
          await unlink(source);
        }
        result.moved++;
      } catch { result.failed++; }
    }
    return result;
  }

  return { stemFor, paths, youtubePaths, atomicWrite, read, readOwn, write, acquireLock, listStoreFiles, moveStoreFiles, signatureOf };
}

module.exports = { createTranscriptStore, youtubeIdFromUrl };
