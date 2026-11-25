"use strict";

// Запись свойств видео, которое открыто в плеере. Обработчик Windows переписывает файл целиком, когда в moov
// не хватает места (первая запись в файл без свойств), — на больших файлах это секунды. Плеер держит файл,
// поэтому запись идёт в копию рядом с оригиналом, пока ролик играет, а плеер отпускается только на rename.
// Копия лежит в той же папке (rename внутри тома мгновенный) и сохраняет расширение: от него зависит обработчик.

const { stat, copyFile, rename, rm } = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const STAGING_PREFIX = '.fv-props-';
const RENAME_ATTEMPTS = 30;
const RENAME_DELAY_MS = 100;
const BUSY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function isStagingFile(name) { return name.startsWith(STAGING_PREFIX); }

class PropertyStaging {
  constructor() { this.items = new Map(); }

  // write(target, timesFrom) пишет свойства в target и выставляет ему даты timesFrom. Возвращает { token, result }.
  async stage(filePath, write, meta = {}) {
    const before = await stat(filePath);
    const temporary = path.join(path.dirname(filePath), `${STAGING_PREFIX}${process.pid}-${Date.now()}-${path.basename(filePath)}`);
    try {
      await copyFile(filePath, temporary);
      const result = await write(temporary, filePath);
      const token = randomUUID();
      this.items.set(token, { temporary, filePath, size: before.size, mtimeMs: before.mtimeMs, result, meta });
      return { token, result };
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {});
      if (error && error.code === 'ENOSPC') throw new Error('Недостаточно места на диске для временной копии видео');
      throw error;
    }
  }

  // Подмена оригинала подготовленной копией. Вызывать после того, как плеер отпустил файл.
  async commit(token) {
    const item = this.items.get(token);
    if (!item) throw new Error('Подготовленная запись свойств не найдена');
    this.items.delete(token);
    try {
      const current = await stat(item.filePath);
      if (current.size !== item.size || current.mtimeMs !== item.mtimeMs) throw new Error('Видео изменилось во время записи свойств — повторите');
      for (let attempt = 1; ; attempt += 1) {
        try { await rename(item.temporary, item.filePath); break; } catch (error) {
          if (!BUSY_CODES.has(error.code)) throw error;
          if (attempt >= RENAME_ATTEMPTS) throw new Error('Файл занят другой программой — закройте её и повторите');
          await delay(RENAME_DELAY_MS);
        }
      }
      return { filePath: item.filePath, result: item.result, meta: item.meta };
    } catch (error) {
      await rm(item.temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  async discard(token) {
    const item = this.items.get(token);
    if (!item) return;
    this.items.delete(token);
    await rm(item.temporary, { force: true }).catch(() => {});
  }

  async discardAll() { await Promise.all([...this.items.keys()].map(token => this.discard(token))); }
}

module.exports = { PropertyStaging, isStagingFile, STAGING_PREFIX };
