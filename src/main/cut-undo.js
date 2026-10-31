"use strict";

const { copyFile, mkdir, readFile, readdir, rename, rm, rmdir, stat, utimes, writeFile } = require('node:fs/promises');
const { randomBytes } = require('node:crypto');
const path = require('node:path');

const UNDO_DIRECTORY = '.fv-undo';
const RENAME_ATTEMPTS = 12;
const RENAME_DELAY_MS = 250;

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

// Файл может быть занят системой (плеер, антивирус): повторяем переименование.
async function renameWithRetry(from, to) {
  for (let attempt = 1; ; attempt++) {
    try { return await rename(from, to); }
    catch (error) {
      if (!['EBUSY', 'EPERM', 'EACCES'].includes(error.code) || attempt >= RENAME_ATTEMPTS) throw error;
      await delay(RENAME_DELAY_MS);
    }
  }
}

async function exists(filePath) {
  try { await stat(filePath); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function entryId(now) { return `${new Date(now).toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomBytes(3).toString('hex')}`; }

// Бэкапы оригиналов лежат в .fv-undo рядом с видео; реестр бэкапов — один JSON-файл приложения.
class CutUndoStore {
  constructor(registryPath, options = {}) {
    this.registryPath = registryPath;
    this.now = options.now || Date.now;
    this.queue = Promise.resolve();
  }

  serialize(task) {
    const result = this.queue.then(task, task);
    this.queue = result.catch(() => {});
    return result;
  }

  async readEntries() {
    try {
      const parsed = JSON.parse(await readFile(this.registryPath, 'utf8'));
      return Array.isArray(parsed.entries) ? parsed.entries : [];
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw new Error(`Не удалось прочитать реестр бэкапов: ${error.message}`);
    }
  }

  async writeEntries(entries) {
    await mkdir(path.dirname(this.registryPath), { recursive: true });
    const temporary = `${this.registryPath}.${process.pid}.tmp`;
    try { await writeFile(temporary, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`, 'utf8'); await rename(temporary, this.registryPath); }
    catch (error) { await rm(temporary, { force: true }).catch(() => {}); throw error; }
  }

  // Подменяет sourcePath готовым tempPath, оригинал и побочные файлы (заметки) уходят в бэкап.
  commit({ sourcePath, tempPath, sidecars = [], ranges = [], precise = false }) {
    return this.serialize(async () => {
      const original = await stat(sourcePath);
      const createdAt = this.now();
      const id = entryId(createdAt);
      const undoDirectory = path.join(path.dirname(sourcePath), UNDO_DIRECTORY);
      const backupPath = path.join(undoDirectory, `${id}__${path.basename(sourcePath)}`);
      await mkdir(undoDirectory, { recursive: true });

      const sidecarEntries = [];
      try {
        for (const [index, target] of sidecars.entries()) {
          if (await exists(target)) {
            const backup = path.join(undoDirectory, `${id}__sidecar${index}__${path.basename(target)}`);
            await copyFile(target, backup);
            sidecarEntries.push({ target, backup });
          } else sidecarEntries.push({ target, backup: null });
        }
        await renameWithRetry(sourcePath, backupPath);
      } catch (error) {
        await Promise.all(sidecarEntries.filter(item => item.backup).map(item => rm(item.backup, { force: true }).catch(() => {})));
        throw error;
      }
      try { await renameWithRetry(tempPath, sourcePath); }
      catch (error) {
        await renameWithRetry(backupPath, sourcePath).catch(() => {});
        await Promise.all(sidecarEntries.filter(item => item.backup).map(item => rm(item.backup, { force: true }).catch(() => {})));
        throw error;
      }
      await utimes(sourcePath, original.atime, original.mtime).catch(() => {});
      const result = await stat(sourcePath);
      const entry = { id, createdAt, sourcePath, backupPath, originalSize: original.size, resultSize: result.size, resultMtimeMs: result.mtimeMs, ranges, precise: Boolean(precise), sidecars: sidecarEntries };
      await this.writeEntries([...(await this.readEntries()), entry]);
      return entry;
    });
  }

  // Возвращает оригинал на место. Если результат вырезки изменили снаружи, отказывает.
  undo(id) {
    return this.serialize(async () => {
      const entries = await this.readEntries();
      const entry = entries.find(item => item.id === id);
      if (!entry) throw new Error('Бэкап не найден.');
      if (!await exists(entry.backupPath)) throw new Error('Файл бэкапа уже удалён.');
      let displaced = null;
      if (await exists(entry.sourcePath)) {
        const current = await stat(entry.sourcePath);
        if (current.size !== entry.resultSize || Math.abs(current.mtimeMs - entry.resultMtimeMs) > 1) throw new Error('Файл изменён после вырезки, отмена небезопасна.');
        displaced = `${entry.backupPath}.undone`;
        await renameWithRetry(entry.sourcePath, displaced);
      }
      try { await renameWithRetry(entry.backupPath, entry.sourcePath); }
      catch (error) {
        if (displaced) await renameWithRetry(displaced, entry.sourcePath).catch(() => {});
        throw error;
      }
      if (displaced) await rm(displaced, { force: true }).catch(() => {});
      for (const item of entry.sidecars || []) {
        try {
          if (item.backup) { await mkdir(path.dirname(item.target), { recursive: true }); await copyFile(item.backup, item.target); await rm(item.backup, { force: true }); }
          else await rm(item.target, { force: true });
        } catch { /* заметки не должны мешать возврату видео */ }
      }
      await this.writeEntries(entries.filter(item => item.id !== id));
      await this.removeEmptyDirectory(path.dirname(entry.backupPath));
      return entry;
    });
  }

  async removeEmptyDirectory(directory) {
    try { if (!(await readdir(directory)).length) await rmdir(directory); } catch { /* каталог занят или уже удалён */ }
  }

  async discardEntry(entry) {
    await rm(entry.backupPath, { force: true }).catch(() => {});
    await Promise.all((entry.sidecars || []).filter(item => item.backup).map(item => rm(item.backup, { force: true }).catch(() => {})));
    await this.removeEmptyDirectory(path.dirname(entry.backupPath));
  }

  discard(id) {
    return this.serialize(async () => {
      const entries = await this.readEntries();
      const entry = entries.find(item => item.id === id);
      if (!entry) return false;
      await this.discardEntry(entry);
      await this.writeEntries(entries.filter(item => item.id !== id));
      return true;
    });
  }

  // Бэкапы с признаком available: false, если файл бэкапа уже пропал. Новые первыми.
  list() {
    return this.serialize(async () => {
      const entries = await this.readEntries();
      const result = await Promise.all(entries.map(async entry => ({ ...entry, available: await exists(entry.backupPath) })));
      return result.sort((a, b) => b.createdAt - a.createdAt);
    });
  }

  // Удаляет бэкапы старше maxAgeMs и записи, у которых файла бэкапа уже нет.
  prune(maxAgeMs) {
    return this.serialize(async () => {
      const entries = await this.readEntries();
      const limit = this.now() - maxAgeMs;
      const keep = [];
      let removed = 0;
      for (const entry of entries) {
        if (entry.createdAt < limit || !await exists(entry.backupPath)) { await this.discardEntry(entry); removed++; }
        else keep.push(entry);
      }
      if (removed) await this.writeEntries(keep);
      return removed;
    });
  }

  clear() {
    return this.serialize(async () => {
      const entries = await this.readEntries();
      for (const entry of entries) await this.discardEntry(entry);
      await this.writeEntries([]);
      return entries.length;
    });
  }
}

module.exports = { CutUndoStore, UNDO_DIRECTORY };
