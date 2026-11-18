"use strict";
// Эталонная логика общего хранилища транскрипций (спецификация: docs/transcript-store.md).
// Чистый модуль без Node.js API: SHA-256 пути и проверку процесса передаёт вызывающий код.

const MANIFEST_VERSION = 3;
const FILE_KEY_LENGTH = 16;
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

// Схема v3: `yt-<id>` — ролик YouTube, `yt-<id>.<вариант>` — изменённая копия ролика (перевод, ускорение),
// `file-<16 символов SHA-256 содержимого>` — локальное видео без известного ролика.
// Старая схема `<имя>__<12 символов SHA-256 пути>` (fileStem) только читается и переносится.
function fileKeyStem(sha256) {
  const hex = String(sha256 || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('Нужен SHA-256 содержимого видео');
  return `file-${hex.slice(0, FILE_KEY_LENGTH)}`;
}

const VARIANT_LABEL = /^(?:([A-Za-z]{2,3})(?:_(\d+(?:\.\d+)?)x)?|(\d+(?:\.\d+)?)x)$/;

// Метка варианта: язык и/или скорость. Скорость 1x в метке не пишется; язык — заглавными: RU, RU_2x, 1.5x.
function variantLabel({ language, speed } = {}) {
  const lang = language ? String(language).toUpperCase() : '';
  const rate = Number(speed) > 0 && Number(speed) !== 1 ? `${Number(speed)}x` : '';
  if (lang && rate) return `${lang}_${rate}`;
  return lang || rate || '';
}

function parseVariantLabel(label) {
  const match = VARIANT_LABEL.exec(String(label || ''));
  if (!match) return null;
  const language = match[1] ? match[1].toUpperCase() : '';
  const speed = Number(match[2] || match[3] || 1);
  return { label: variantLabel({ language, speed }), language: language.toLowerCase(), speed };
}

// Вариант по имени файла: язык в скобках (`(RU)`) и/или скорость в конце (`_2x`). Без того и другого файл — оригинал.
function variantFromFileName(fileName) {
  const base = String(fileName).split(/[\\/]/).pop();
  const dot = base.lastIndexOf('.');
  const name = dot > 0 ? base.slice(0, dot) : base;
  const lang = [...name.matchAll(/\(([A-Za-z]{2,3})\)/g)].pop();
  const rate = /_(\d+(?:\.\d+)?)x$/.exec(name);
  const label = variantLabel({ language: lang ? lang[1] : '', speed: rate ? Number(rate[1]) : 1 });
  return label ? parseVariantLabel(label) : null;
}

// Код ролика YouTube в имени файла: `Название [dQw4w9WgXcQ] (RU)_2x.mp4`.
function youtubeIdFromFileName(fileName) {
  const base = String(fileName).split(/[\\/]/).pop();
  const match = [...base.matchAll(/\[([\w-]{11})\]/g)].pop();
  return match ? match[1] : '';
}

function youtubeIdFromUrl(value) {
  try {
    const url = new URL(value);
    const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v');
    return YOUTUBE_ID.test(id || '') ? id : '';
  } catch { return ''; }
}

// Имя набора файлов: у ролика (и его копии) — по коду ролика, иначе по содержимому видео.
function stemFor({ sha256, youtubeId, variant }) {
  if (youtubeId) return variant && variant.label ? `${youtubeStem(youtubeId)}.${variant.label}` : youtubeStem(youtubeId);
  return fileKeyStem(sha256);
}

// Разбор имени набора: { kind: 'youtube', id, variant? } | { kind: 'file', key } | { kind: 'legacy', name, pathHash } | null.
function parseStem(stem) {
  const text = String(stem || '');
  let match = /^yt-([\w-]{11})(?:\.([^.]+))?$/.exec(text);
  if (match) {
    const variant = match[2] ? parseVariantLabel(match[2]) : null;
    if (match[2] && !variant) return null;
    return { kind: 'youtube', id: match[1], variant };
  }
  match = /^file-([0-9a-f]{16})$/.exec(text);
  if (match) return { kind: 'file', key: match[1] };
  match = /^(.+)__([0-9a-f]{12})$/.exec(text);
  if (match) return { kind: 'legacy', name: match[1], pathHash: match[2] };
  return null;
}

function isYoutubeId(id) { return typeof id === 'string' && YOUTUBE_ID.test(id); }

function youtubeStem(id) {
  if (!isYoutubeId(id)) throw new Error('Это не ролик YouTube с одним видео');
  return `yt-${id}`;
}

function fileManifestSource({ filePath, size, mtimeMs, sha256, youtubeId }) {
  const source = { kind: 'file', path: filePath, size, mtimeMs };
  if (sha256) source.sha256 = sha256;
  if (youtubeId) source.youtubeId = youtubeId;
  return source;
}

function buildManifest({ source, model = '', engine = 'parakeet-tdt', language, createdAt, createdBy, translations, variant }) {
  const transcript = { model: model ? String(model).split(/[\\/]/).pop() : '', engine, createdAt: createdAt || new Date().toISOString(), createdBy };
  if (language) transcript.language = language;
  const manifest = { version: MANIFEST_VERSION, source, transcript, translations: translations || {} };
  if (variant && variant.label) manifest.variant = { label: variant.label, language: variant.language || '', speed: variant.speed || 1 };
  return manifest;
}

// Читает манифест v1 (`filePath/size/mtimeMs/modelPath`) и v2; для неверной структуры возвращает null.
function readManifest(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if ((raw.version === 2 || raw.version === MANIFEST_VERSION) && raw.source && typeof raw.source === 'object') {
    return { version: raw.version, source: raw.source, transcript: raw.transcript || {}, translations: raw.translations || {}, variant: raw.variant && raw.variant.label ? raw.variant : null };
  }
  if (typeof raw.filePath === 'string') {
    return {
      version: 1,
      source: { kind: 'file', path: raw.filePath, size: raw.size, mtimeMs: raw.mtimeMs },
      transcript: { model: raw.modelPath ? String(raw.modelPath).split(/[\\/]/).pop() : '' },
      translations: {},
      variant: null
    };
  }
  return null;
}

// Транскрипция актуальна, пока не менялось видео. Модель и приложение не сравниваются.
function isTranscriptFresh(manifest, signature) {
  const m = readManifest(manifest);
  if (!m || m.source.kind !== 'file') return false;
  if (m.source.sha256 && signature.sha256) return m.source.sha256 === signature.sha256;
  return m.source.path === signature.filePath && m.source.size === signature.size && m.source.mtimeMs === signature.mtimeMs;
}

// Манифест описывает то же видео, которое перенесли: другой путь, тот же размер и mtime.
function isMovedSource(manifest, signature) {
  const m = readManifest(manifest);
  if (!m || m.source.kind !== 'file' || typeof m.source.path !== 'string') return false;
  return m.source.path !== signature.filePath && m.source.size === signature.size && m.source.mtimeMs === signature.mtimeMs;
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

const core = { MANIFEST_VERSION, FILE_KEY_LENGTH, LOCK_MAX_AGE_MS, fileKeyStem, variantLabel, parseVariantLabel, variantFromFileName, youtubeIdFromFileName, youtubeIdFromUrl, stemFor, parseStem, fileStem, isYoutubeId, youtubeStem, fileManifestSource, buildManifest, readManifest, isTranscriptFresh, isMovedSource, isSummaryFresh, buildLock, isLockStale, wordsToPhrases, toSrt, srtTime, round2 };
if (typeof module !== 'undefined' && module.exports) module.exports = core;
else globalThis.TranscriptStoreCore = core;
