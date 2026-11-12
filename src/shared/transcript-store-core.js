"use strict";
// Эталонная логика общего хранилища транскрипций (спецификация: docs/transcript-store.md).
// Чистый модуль без Node.js API: SHA-256 пути и проверку процесса передаёт вызывающий код.

const MANIFEST_VERSION = 2;
const LOCK_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const YOUTUBE_ID = /^[\w-]{11}$/;

// Имя файлов локального видео: `<имя без расширения>__<первые 12 символов SHA-256 полного пути>`.
// Менять нельзя: по нему находятся уже созданные файлы всех приложений.
function fileStem(filePath, pathHashHex) {
  const base = String(filePath).split(/[\\/]/).pop();
  const dot = base.lastIndexOf('.');
  const name = dot > 0 ? base.slice(0, dot) : base;
  const safeName = name.replace(/[<>:"/\\|?*]/g, '_').slice(0, 120) || 'video';
  return `${safeName}__${String(pathHashHex).slice(0, 12)}`;
}

function isYoutubeId(id) { return typeof id === 'string' && YOUTUBE_ID.test(id); }

function youtubeStem(id) {
  if (!isYoutubeId(id)) throw new Error('Это не ролик YouTube с одним видео');
  return `yt-${id}`;
}

function fileManifestSource({ filePath, size, mtimeMs, sha256 }) {
  const source = { kind: 'file', path: filePath, size, mtimeMs };
  if (sha256) source.sha256 = sha256;
  return source;
}

function buildManifest({ source, model = '', engine = 'parakeet-tdt', language, createdAt, createdBy, translations }) {
  const transcript = { model: model ? String(model).split(/[\\/]/).pop() : '', engine, createdAt: createdAt || new Date().toISOString(), createdBy };
  if (language) transcript.language = language;
  return { version: MANIFEST_VERSION, source, transcript, translations: translations || {} };
}

// Читает манифест v1 (`filePath/size/mtimeMs/modelPath`) и v2; для неверной структуры возвращает null.
function readManifest(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.version === MANIFEST_VERSION && raw.source && typeof raw.source === 'object') {
    return { version: MANIFEST_VERSION, source: raw.source, transcript: raw.transcript || {}, translations: raw.translations || {} };
  }
  if (typeof raw.filePath === 'string') {
    return {
      version: 1,
      source: { kind: 'file', path: raw.filePath, size: raw.size, mtimeMs: raw.mtimeMs },
      transcript: { model: raw.modelPath ? String(raw.modelPath).split(/[\\/]/).pop() : '' },
      translations: {}
    };
  }
  return null;
}

// Транскрипция актуальна, пока не менялось видео. Модель и приложение не сравниваются.
function isTranscriptFresh(manifest, signature) {
  const m = readManifest(manifest);
  if (!m || m.source.kind !== 'file') return false;
  return m.source.path === signature.filePath && m.source.size === signature.size && m.source.mtimeMs === signature.mtimeMs;
}

// Сводка актуальна, пока не менялся текст транскрипции.
function isSummaryFresh(saved, transcriptHash) {
  return Boolean(saved) && typeof saved.transcriptHash === 'string' && saved.transcriptHash === transcriptHash;
}

function buildLock({ app, pid, startedAt }) {
  return { app, pid, startedAt: startedAt || new Date().toISOString() };
}

// pidAlive — функция проверки процесса (в main: process.kill(pid, 0)).
function isLockStale(lock, now = Date.now(), pidAlive = () => true) {
  if (!lock || !Number.isInteger(lock.pid)) return true;
  const started = Date.parse(lock.startedAt);
  if (!Number.isFinite(started) || now - started > LOCK_MAX_AGE_MS) return true;
  return !pidAlive(lock.pid);
}

const round2 = value => Math.round(value * 100) / 100;

// Слова с таймингами → фразы: разрыв при паузе больше секунды или фразе длиннее 30 с,
// фраза закрывается на знаке конца предложения. Совпадает с phrases() прежнего transcribe_handy.py.
function wordsToPhrases(words) {
  const result = [];
  let current = [];
  const close = () => {
    if (!current.length) return;
    result.push({ start: current[0].start, end: current[current.length - 1].end, text: current.map(word => word.text).join(' ') });
    current = [];
  };
  for (const word of words) {
    if (current.length && (word.start - current[current.length - 1].end > 1 || word.end - current[0].start > 30)) close();
    current.push(word);
    if (/[.!?…]$/.test(word.text)) close();
  }
  close();
  return result;
}

function srtTime(seconds) {
  const total = Math.round(Math.max(0, seconds) * 1000);
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const ms = total % 1000;
  const pad = (value, size) => String(value).padStart(size, '0');
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`;
}

function toSrt(segments) {
  return segments.map((segment, index) => `${index + 1}\n${srtTime(segment.start)} --> ${srtTime(segment.end)}\n${segment.text}\n`).join('\n');
}

const core = { MANIFEST_VERSION, LOCK_MAX_AGE_MS, fileStem, isYoutubeId, youtubeStem, fileManifestSource, buildManifest, readManifest, isTranscriptFresh, isSummaryFresh, buildLock, isLockStale, wordsToPhrases, toSrt, srtTime, round2 };
if (typeof module !== 'undefined' && module.exports) module.exports = core;
else globalThis.TranscriptStoreCore = core;
