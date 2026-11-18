"use strict";
// Файлы общего хранилища транскрипций (спецификация: docs/transcript-store.md).
const { readFile, writeFile, rename, rm, mkdir, readdir, lstat, copyFile, unlink } = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const core = require('../shared/transcript-store-core');
const { hashFile: defaultHashFile } = require('./hash-file');

const APP_NAMES = { 'folder-video': 'Folder-video', okoshko: 'Окошко', 'youtube-radar': 'YouTube Radar' };
const STORE_FILE = /\.(srt|txt|json|notes\.md|summary\.json|lock|ru\.srt|ru\.txt)$/i;
// Файлы набора: суффиксы, которые переименовываются вместе при смене имени набора.
const SET_SUFFIXES = ['.srt', '.txt', '.json', '.notes.md', '.summary.json', '.ru.srt', '.ru.txt'];
const HASH_CACHE_LIMIT = 5000;

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

const youtubeIdFromUrl = core.youtubeIdFromUrl;

// getSourceInfo(filePath, sha256) -> { youtubeId?, variant? } | null: код ролика и вариант из метаданных файла, ссылки в Folder-video и т. п.
// cacheFile — кэш «путь|размер|mtime → SHA-256»; unmigratedFile — список наборов, которые не удалось переименовать.
function createTranscriptStore({ getDirectory, appId = 'folder-video', hashFile = defaultHashFile, getSourceInfo = null, cacheFile = '', unmigratedFile = '' }) {
  const pathHash = filePath => createHash('sha256').update(filePath).digest('hex');
  const legacyStemFor = filePath => core.fileStem(filePath, pathHash(filePath));
  const resolved = new Map();
  const pathOf = value => (typeof value === 'function' ? value() : value);

  function pathsForStem(directory, stem) {
    const base = path.join(directory, stem);
    return { directory, stem, srtPath: `${base}.srt`, txtPath: `${base}.txt`, manifestPath: `${base}.json`, lockPath: `${base}.lock`, notesPath: `${base}.notes.md`, summaryPath: `${base}.summary.json`, ruSrtPath: `${base}.ru.srt`, ruTxtPath: `${base}.ru.txt` };
  }

  // Синхронно: имя набора известно после prepare(); до него — старое имя (по хэшу пути).
  function paths(filePath) {
    const info = resolved.get(filePath);
    return pathsForStem(getDirectory(), info ? info.stem : legacyStemFor(filePath));
  }
  const stemFor = filePath => paths(filePath).stem;
  const youtubePaths = id => pathsForStem(getDirectory(), core.youtubeStem(id));

  async function atomicWrite(target, data) {
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    try { await writeFile(temporary, data, typeof data === 'string' ? 'utf8' : undefined); await rename(temporary, target); }
    catch (error) { await rm(temporary, { force: true }).catch(() => {}); throw error; }
  }

  const signatureOf = (filePath, stat) => ({ filePath, size: stat.size, mtimeMs: stat.mtimeMs });
  const exists = target => lstat(target).then(() => true, () => false);
  const readJson = async file => JSON.parse(await readFile(file, 'utf8'));

  // ---- кэш SHA-256 содержимого ----
  let hashCache = null;
  let hashCacheDirty = false;
  async function loadHashCache() {
    if (hashCache) return hashCache;
    hashCache = new Map();
    if (pathOf(cacheFile)) { try { for (const [key, value] of Object.entries(await readJson(pathOf(cacheFile)))) hashCache.set(key, value); } catch { /* кэша ещё нет */ } }
    return hashCache;
  }
  async function saveHashCache() {
    if (!pathOf(cacheFile) || !hashCacheDirty) return;
    hashCacheDirty = false;
    while (hashCache.size > HASH_CACHE_LIMIT) hashCache.delete(hashCache.keys().next().value);
    await atomicWrite(pathOf(cacheFile), JSON.stringify(Object.fromEntries(hashCache))).catch(() => {});
  }
  async function contentHash(filePath, stat) {
    const cache = await loadHashCache();
    const key = `${filePath}|${stat.size}|${stat.mtimeMs}`;
    let sha = cache.get(key);
    if (!sha) {
      sha = await hashFile(filePath);
      cache.set(key, sha);
      hashCacheDirty = true;
      await saveHashCache();
    }
    return sha;
  }

  // ---- список наборов, которые не удалось переименовать ----
  async function readUnmigrated() {
    if (!pathOf(unmigratedFile)) return [];
    try { const list = await readJson(pathOf(unmigratedFile)); return Array.isArray(list) ? list : []; } catch { return []; }
  }
  async function writeUnmigrated(list) {
    if (!pathOf(unmigratedFile)) return;
    if (list.length) await atomicWrite(pathOf(unmigratedFile), `${JSON.stringify(list, null, 2)}\n`).catch(() => {});
    else await rm(pathOf(unmigratedFile), { force: true }).catch(() => {});
  }
  async function addUnmigrated(entry) {
    const list = (await readUnmigrated()).filter(item => item.stem !== entry.stem);
    list.push({ ...entry, at: new Date().toISOString() });
    await writeUnmigrated(list);
  }
  async function removeUnmigrated(stem) {
    const list = await readUnmigrated();
    const next = list.filter(item => item.stem !== stem);
    if (next.length !== list.length) await writeUnmigrated(next);
  }

  // Переименовывает набор файлов; существующие файлы нового имени не перезаписываются.
  // Манифест при этом приводится к версии 3, путь в манифесте и сводке обновляется.
  async function moveSet(fromStem, toStem, info, filePath, stat) {
    const directory = getDirectory();
    const result = { moved: 0, conflicts: [] };
    for (const suffix of SET_SUFFIXES) {
      const from = path.join(directory, `${fromStem}${suffix}`);
      const to = path.join(directory, `${toStem}${suffix}`);
      if (!(await exists(from))) continue;
      if (await exists(to)) { result.conflicts.push(suffix); continue; }
      try { await rename(from, to); result.moved++; } catch { result.conflicts.push(suffix); }
    }
    const target = pathsForStem(directory, toStem);
    try {
      const manifest = core.readManifest(await readJson(target.manifestPath));
      if (manifest) {
        const next = core.buildManifest({
          source: core.fileManifestSource({ filePath, size: stat.size, mtimeMs: stat.mtimeMs, sha256: info.sha256, youtubeId: info.youtubeId }),
          model: manifest.transcript.model, engine: manifest.transcript.engine || 'parakeet-tdt', language: manifest.transcript.language,
          createdAt: manifest.transcript.createdAt, createdBy: manifest.transcript.createdBy || appId, translations: manifest.translations, variant: info.variant
        });
        await atomicWrite(target.manifestPath, `${JSON.stringify(next, null, 2)}\n`);
      }
    } catch { /* манифеста нет */ }
    try {
      const summary = await readJson(target.summaryPath);
      if (typeof summary.filePath === 'string') { summary.filePath = filePath; await atomicWrite(target.summaryPath, `${JSON.stringify(summary, null, 2)}\n`); }
    } catch { /* сводки нет */ }
    if (result.conflicts.length) {
      await addUnmigrated({ stem: fromStem, reason: `Под новым именем «${toStem}» уже есть файлы: ${result.conflicts.join(', ')}`, title: path.parse(filePath).name, sourcePath: filePath, size: stat.size, mtimeMs: stat.mtimeMs });
    } else await removeUnmigrated(fromStem);
    return result;
  }

  // Старый набор того же видео по другому пути (видео перенесли): тот же размер и mtime, старого файла уже нет.
  async function findMovedLegacy(filePath, stat, directory) {
    const prefix = core.fileStem(filePath, pathHash(filePath)).slice(0, -12);
    let names;
    try { names = await readdir(directory); } catch { return null; }
    const own = legacyStemFor(filePath);
    const signature = signatureOf(filePath, stat);
    const candidates = [];
    for (const name of names) {
      if (!name.startsWith(prefix) || !/^[0-9a-f]{12}\.json$/i.test(name.slice(prefix.length))) continue;
      const stem = name.slice(0, -5);
      if (stem === own) continue;
      try {
        const manifest = await readJson(path.join(directory, name));
        if (!core.isMovedSource(manifest, signature)) continue;
        if (await exists(core.readManifest(manifest).source.path)) continue;
        candidates.push(stem);
      } catch { /* повреждённый манифест пропускаем */ }
    }
    return candidates.length === 1 ? candidates[0] : null;
  }

  // Переименование наборов под имя v3: набор `file-<хэш>` → `yt-<код>` (код стал известен), набор со старым именем (по хэшу пути) → новое.
  async function migrate(filePath, stat, info) {
    const directory = getDirectory();
    const target = pathsForStem(directory, info.stem);
    if (await exists(target.manifestPath)) return;
    const sources = [];
    if (info.youtubeId) sources.push(core.fileKeyStem(info.sha256));
    sources.push(legacyStemFor(filePath));
    for (const stem of sources) {
      if (stem !== info.stem && await exists(pathsForStem(directory, stem).manifestPath)) { await moveSet(stem, info.stem, info, filePath, stat); return; }
    }
    const moved = await findMovedLegacy(filePath, stat, directory);
    if (moved) await moveSet(moved, info.stem, info, filePath, stat);
  }

  // Определяет имя набора видео: код ролика (метаданные файла, имя, ссылка) или SHA-256 содержимого; переносит набор со старым именем.
  async function prepare(filePath, stat) {
    const key = `${filePath}|${stat.size}|${stat.mtimeMs}`;
    const cached = resolved.get(filePath);
    if (cached && cached.key === key) return cached;
    const sha256 = await contentHash(filePath, stat);
    let source = null;
    try { source = getSourceInfo ? await getSourceInfo(filePath, sha256) : null; } catch { /* метаданных нет */ }
    const youtubeId = (source && source.youtubeId) || core.youtubeIdFromFileName(filePath) || '';
    const variant = youtubeId ? ((source && source.variant) || core.variantFromFileName(filePath)) : null;
    const info = { key, sha256, youtubeId, variant, stem: core.stemFor({ sha256, youtubeId, variant }) };
    resolved.set(filePath, info);
    try { await migrate(filePath, stat, info); } catch { /* перенос не удался — набор останется под старым именем */ }
    return info;
  }

  async function prepareFile(filePath) { return prepare(filePath, await lstat(filePath)); }

  // Транскрипция самого видео: { available, srt, srtPath } | { available: false, stale? } | { error }.
  async function readOwn(filePath, stat) {
    const info = await prepare(filePath, stat);
    const p = paths(filePath);
    try {
      const manifest = await readJson(p.manifestPath);
      const m = core.readManifest(manifest);
      // Транскрипция ролика (от Radar или Окошка) подходит видео без изменений; у копии — только свой вариант.
      const fresh = m && m.source.kind === 'youtube' ? true : core.isTranscriptFresh(manifest, { ...signatureOf(filePath, stat), sha256: info.sha256 });
      if (!fresh) return { available: false, stale: true };
      return { available: true, srt: await readFile(p.srtPath, 'utf8'), srtPath: p.srtPath, stem: p.stem, youtubeId: info.youtubeId, variant: info.variant, fromYoutube: Boolean(m && m.source.kind === 'youtube') };
    } catch (error) {
      return error.code === 'ENOENT' ? { available: false } : { error: `Не удалось открыть транскрипцию: ${error.message}` };
    }
  }
  const read = readOwn;

  async function write(filePath, stat, segments, model) {
    const info = await prepare(filePath, stat);
    const p = paths(filePath);
    const manifest = core.buildManifest({
      source: core.fileManifestSource({ ...signatureOf(filePath, stat), sha256: info.sha256, youtubeId: info.youtubeId }),
      model, createdBy: appId, variant: info.variant
    });
    const text = segments.map(segment => segment.text).join('\n');
    await atomicWrite(p.srtPath, core.toSrt(segments));
    await atomicWrite(p.txtPath, `${text}\n`);
    await atomicWrite(p.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return p;
  }

  // Lock транскрибации: { release } или { error }. Устаревший lock (процесса нет или прошло 6 часов) снимается.
  async function acquireLock(filePath) {
    try { await prepareFile(filePath); } catch (error) { return { error: `Не удалось прочитать видео: ${error.message}` }; }
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
      if (await exists(target)) { result.skipped++; continue; }
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

  // Разовый перенос всех наборов со старым именем (`<имя>__<хэш пути>`). Если видео по пути из манифеста нет — набор попадает в список неперенесённых.
  async function migrateAll(onProgress) {
    const directory = getDirectory();
    let names;
    try { names = await readdir(directory); } catch { return { total: 0, migrated: 0, remaining: (await readUnmigrated()).length }; }
    const legacy = names.filter(name => core.parseStem(name.slice(0, -5))?.kind === 'legacy' && name.endsWith('.json'));
    let migrated = 0;
    const unreachable = new Set();
    for (const [index, name] of legacy.entries()) {
      const stem = name.slice(0, -5);
      if (onProgress) onProgress({ done: index, total: legacy.length });
      let manifest = null;
      try { manifest = core.readManifest(await readJson(path.join(directory, name))); } catch { /* повреждён */ }
      if (!manifest || manifest.source.kind !== 'file') continue;
      const sourcePath = manifest.source.path;
      let stat = null;
      const root = path.parse(sourcePath).root.toLowerCase();
      if (!unreachable.has(root)) {
        try { stat = await Promise.race([lstat(sourcePath), new Promise((_resolve, reject) => setTimeout(() => reject(Object.assign(new Error('диск не отвечает'), { code: 'ETIMEDOUT' })), 5000))]); if (!stat.isFile()) stat = null; }
        catch (error) { if (error.code === 'ETIMEDOUT') unreachable.add(root); }
      }
      if (!stat) {
        await addUnmigrated({ stem, reason: unreachable.has(root) ? `Диск ${root} недоступен` : 'Видео не найдено по прежнему пути', title: path.parse(sourcePath).name, sourcePath, size: manifest.source.size, mtimeMs: manifest.source.mtimeMs });
        continue;
      }
      resolved.delete(sourcePath);
      const info = await prepare(sourcePath, stat);
      if (!(await exists(pathsForStem(directory, stem).manifestPath))) migrated++;
      else if (info.stem !== stem) await addUnmigrated({ stem, reason: `Для этого видео уже есть набор «${info.stem}» (то же содержимое по другому пути)`, title: path.parse(sourcePath).name, sourcePath, size: manifest.source.size, mtimeMs: manifest.source.mtimeMs });
    }
    if (onProgress) onProgress({ done: legacy.length, total: legacy.length });
    return { total: legacy.length, migrated, remaining: (await readUnmigrated()).length };
  }

  // «Указать видео»: набор со старым именем привязывается к выбранному файлу (размер должен совпадать с манифестом).
  async function adoptUnmigrated(stem, filePath) {
    const entry = (await readUnmigrated()).find(item => item.stem === stem);
    if (!entry) return { error: 'Записи нет в списке неперенесённых.' };
    let stat;
    try { stat = await lstat(filePath); if (!stat.isFile()) throw new Error('не файл'); } catch (error) { return { error: `Не удалось прочитать видео: ${error.message}` }; }
    if (Number.isFinite(entry.size) && entry.size !== stat.size) return { error: 'Размер выбранного видео не совпадает с видео, для которого создана транскрипция.' };
    resolved.delete(filePath);
    const info = await prepare(filePath, stat);
    const directory = getDirectory();
    if (await exists(pathsForStem(directory, stem).manifestPath)) {
      if (info.stem === stem) { await removeUnmigrated(stem); return { success: true, stem }; }
      const result = await moveSet(stem, info.stem, info, filePath, stat);
      return result.conflicts.length ? { error: `Под новым именем уже есть файлы: ${result.conflicts.join(', ')}` } : { success: true, stem: info.stem };
    }
    await removeUnmigrated(stem);
    return { success: true, stem: info.stem };
  }

  // «Повторить»: если видео по прежнему пути снова доступно — переносит набор.
  async function retryUnmigrated(stem) {
    const entry = (await readUnmigrated()).find(item => item.stem === stem);
    if (!entry) return { error: 'Записи нет в списке неперенесённых.' };
    return adoptUnmigrated(stem, entry.sourcePath);
  }

  // Видео заменено (например, вырезкой фрагмента): набор остаётся за прежним содержимым, заметки переносятся к новому.
  function forget(filePath) { resolved.delete(filePath); }
  function forgetAll() { resolved.clear(); }

  return { stemFor, paths, youtubePaths, atomicWrite, read, readOwn, prepare, prepareFile, forget, forgetAll, write, acquireLock, listStoreFiles, moveStoreFiles, signatureOf, migrateAll, listUnmigrated: readUnmigrated, adoptUnmigrated, retryUnmigrated, legacyStemFor };
}

module.exports = { createTranscriptStore, youtubeIdFromUrl };
