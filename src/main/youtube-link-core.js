"use strict";

// Чистая логика поиска исходника на YouTube: очистка названия, разбор выдачи, выбор кандидата.
// Без Node.js-API: сеть, yt-dlp и запись свойства файла живут в main.js.

const AUTO_PICK_TOLERANCE_SECONDS = 2;
const MAX_CANDIDATES = 5;
const WRITABLE_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov']);
const VIDEO_EXTENSION_PATTERN = /\.(mp4|webm|mov|avi|mkv|m4v|ogv)$/i;
// Хвосты, которые добавляет само приложение: язык дубляжа в скобках и коэффициент ускорения.
const LANGUAGE_SUFFIX_PATTERN = /\s*\((?:RU|EN|UA)\)\s*$/i;
const SPEED_SUFFIX_PATTERN = /_\d+(?:\.\d+)?x\s*$/i;

function cleanSearchTitle(fileName) {
  let title = String(fileName || '').replace(VIDEO_EXTENSION_PATTERN, '').trim();
  for (let guard = 0; guard < 10; guard += 1) {
    const next = title.replace(SPEED_SUFFIX_PATTERN, '').replace(LANGUAGE_SUFFIX_PATTERN, '').trim();
    if (next === title) break;
    title = next;
  }
  return title;
}

function canonicalUrl(videoId) { return 'https://www.youtube.com/watch?v=' + videoId; }

function isVideoId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value); }

// Разрешает только ссылки на ролики YouTube (пустая строка не подходит) — для открытия и записи в свойство.
function isYouTubeVideoUrl(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:') return false;
    if (host === 'youtu.be') return isVideoId(url.pathname.slice(1));
    if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') {
      return url.pathname === '/watch' ? isVideoId(url.searchParams.get('v')) : /^\/(shorts|live|embed)\/[A-Za-z0-9_-]{11}$/.test(url.pathname);
    }
    return false;
  } catch { return false; }
}

// "1:02:03" / "12:34" / "0:45" -> секунды; иначе null (в том числе для прямых эфиров без длительности).
function parseClockDuration(text) {
  if (typeof text !== 'string' || !/^\d+(?::\d{1,2}){1,2}$/.test(text.trim())) return null;
  return text.trim().split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

function textOf(node) {
  if (!node) return '';
  if (typeof node.simpleText === 'string') return node.simpleText;
  return Array.isArray(node.runs) ? node.runs.map(run => run.text || '').join('') : '';
}

function collectVideoRenderers(node, found) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(item => collectVideoRenderers(item, found)); return; }
  if (node.videoRenderer && typeof node.videoRenderer === 'object') found.push(node.videoRenderer);
  Object.keys(node).forEach(key => { if (key !== 'videoRenderer') collectVideoRenderers(node[key], found); });
}

function extractInitialData(html) {
  const marker = html.indexOf('ytInitialData');
  if (marker === -1) return null;
  const start = html.indexOf('{', marker);
  if (start === -1) return null;
  let depth = 0; let inString = false; let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) { try { return JSON.parse(html.slice(start, index + 1)); } catch { return null; } }
    }
  }
  return null;
}

// Страница результатов поиска -> кандидаты в порядке выдачи.
function parseSearchHtml(html) {
  const data = extractInitialData(String(html || ''));
  if (!data) return [];
  const renderers = []; collectVideoRenderers(data, renderers);
  return normalizeCandidates(renderers.map(item => ({
    id: item.videoId,
    title: textOf(item.title),
    channel: textOf(item.ownerText) || textOf(item.longBylineText),
    duration: parseClockDuration(textOf(item.lengthText))
  })));
}

// Строки JSON от `yt-dlp --flat-playlist --dump-json` -> кандидаты.
function parseYtDlpOutput(output) {
  return normalizeCandidates(String(output || '').split(/\r?\n/).filter(Boolean).map(line => {
    try {
      const item = JSON.parse(line);
      return { id: item.id, title: item.title, channel: item.channel || item.uploader || '', duration: typeof item.duration === 'number' ? Math.round(item.duration) : null };
    } catch { return null; }
  }));
}

function normalizeCandidates(items) {
  const seen = new Set(); const result = [];
  for (const item of items) {
    if (!item || !isVideoId(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    result.push({ id: item.id, title: String(item.title || '').trim(), channel: String(item.channel || '').trim(), duration: Number.isFinite(item.duration) ? item.duration : null, url: canonicalUrl(item.id) });
    if (result.length >= MAX_CANDIDATES) break;
  }
  return result;
}

// Автовыбор: лучший кандидат по близости длительности, если разница не больше допуска; иначе null (нужен ручной выбор).
function pickAutoCandidate(candidates, durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  let best = null; let bestDiff = Infinity;
  for (const candidate of candidates) {
    if (candidate.duration === null) continue;
    const diff = Math.abs(candidate.duration - durationSeconds);
    if (diff < bestDiff) { best = candidate; bestDiff = diff; }
  }
  return best && bestDiff <= AUTO_PICK_TOLERANCE_SECONDS ? best : null;
}

function isWritableExtension(extension) { return WRITABLE_EXTENSIONS.has(String(extension || '').toLowerCase()); }

const youtubeLinkCore = {
  AUTO_PICK_TOLERANCE_SECONDS, MAX_CANDIDATES, cleanSearchTitle, canonicalUrl, isVideoId, isYouTubeVideoUrl, parseClockDuration,
  parseSearchHtml, parseYtDlpOutput, pickAutoCandidate, isWritableExtension
};
if (typeof module !== 'undefined' && module.exports) module.exports = youtubeLinkCore;
else globalThis.YoutubeLinkCore = youtubeLinkCore;
