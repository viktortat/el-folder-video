"use strict";

function srtSegments(srt) {
  return srt.replace(/^\uFEFF/, '').replace(/\r/g, '').trim().split(/\n{2,}/).map(block => {
    const lines = block.split('\n');
    const timeLine = lines.findIndex(line => line.includes('-->'));
    if (timeLine < 0) return null;
    const match = lines[timeLine].match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
    if (!match) return null;
    const seconds = offset => Number(match[offset]) * 3600 + Number(match[offset + 1]) * 60 + Number(match[offset + 2]) + Number(match[offset + 3]) / 1000;
    const text = lines.slice(timeLine + 1).join(' ').trim();
    return text ? { start: seconds(1), end: seconds(5), text } : null;
  }).filter(Boolean);
}

function transcriptBatches(segments) {
  const batches = [];
  let current = [];
  let length = 0;
  for (const [index, segment] of segments.entries()) {
    const line = `[${index + 1}] ${Math.floor(segment.start)}с ${segment.text}`;
    if (current.length && length + line.length > 80000) { batches.push(current); current = []; length = 0; }
    current.push(line); length += line.length + 1;
  }
  if (current.length) batches.push(current);
  return batches;
}

function normalizeSummary(raw, segments, allowed) {
  const overview = raw.overview.trim().split(/\n\s*\n/).slice(0, 3).join('\n\n').slice(0, 12000);
  if (!overview) throw new Error('DeepSeek вернул пустую сводку.');
  const seen = new Set();
  const topics = raw.topics.filter(item => item && typeof item === 'object').map(item => {
    const index = Number(item.segmentIndex);
    if (!Number.isInteger(index) || !allowed.has(index) || !segments[index - 1] || seen.has(index)) return null;
    const title = typeof item.title === 'string' ? item.title.trim().slice(0, 180) : '';
    if (!title) return null;
    seen.add(index);
    return { title, description: typeof item.description === 'string' ? item.description.trim().slice(0, 500) : '', start: segments[index - 1].start };
  }).filter(Boolean).sort((a, b) => a.start - b.start).slice(0, 10);
  return { overview, topics };
}

const LINK_PROTOCOL = 'folder-video:';
const FRAME_COUNT = 10;

function formatClock(value) {
  const total = Math.max(0, Math.floor(value));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

// Те же моменты, что у ленты миниатюр в списке видео (app.js, captureFrames).
function frameTimes(duration, count = FRAME_COUNT) {
  const last = Math.max(0, duration - 0.1);
  return Array.from({ length: count }, (_, index) => Math.min(last, duration * index / Math.max(1, count - 1)));
}

function encodePathPart(value) {
  return encodeURIComponent(value).replace(/[()]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

// file:///D:/папка/видео%20(1).mp4 — как local_path в заметках хранилища: кириллица читаемая,
// кодируются только символы, ломающие URL.
function fileLink(filePath) {
  const normalized = String(filePath).replace(/\\/g, '/');
  return `file:///${normalized.replace(/^\/+/, '').replace(/[%#? ]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)}`;
}

function videoLink(filePath, seconds) {
  const time = Number.isFinite(seconds) && seconds > 0 ? `&t=${Math.floor(seconds)}` : '';
  return `folder-video://open?path=${encodePathPart(filePath)}${time}`;
}

function parseVideoLink(value) {
  if (typeof value !== 'string' || !value.toLowerCase().startsWith('folder-video://')) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== LINK_PROTOCOL) return null;
    const filePath = url.searchParams.get('path');
    if (!filePath) return null;
    const time = Number(url.searchParams.get('t'));
    return { path: filePath, time: Number.isFinite(time) && time > 0 ? time : 0 };
  } catch { return null; }
}

// Значение из вывода `reg query ... /ve` или `/v Name`.
function parseRegValue(output) {
  const match = String(output).match(/REG_(?:EXPAND_)?SZ[ \t]+(.+?)\s*$/m);
  return match ? match[1] : '';
}

function splitCommandLine(command) {
  const tokens = [];
  const pattern = /"([^"]*)"|(\S+)/g;
  let match;
  while ((match = pattern.exec(command))) tokens.push({ value: match[1] ?? match[2], quoted: match[1] !== undefined });
  return tokens;
}

// Ключи начала воспроизведения для известных плееров; для остальных время не передаётся.
function playerStartArgs(executable, seconds) {
  const name = executable.split(/[\\/]/).pop().toLowerCase();
  const time = Math.max(0, Math.floor(seconds));
  if (name === 'vlc.exe') return [`--start-time=${time}`];
  if (name === 'mpv.exe') return [`--start=${time}`];
  if (/^mpc-(hc|be)(64)?\.exe$/.test(name)) return ['/start', String(time * 1000)];
  if (/^potplayer(mini)?(64)?\.exe$/.test(name)) return [`/seek=${time}`];
  return null;
}

// Превращает команду "shell\open\command" плеера в запуск файла с нужной секунды.
// null — плеер не поддерживает старт с позиции, файл открывается обычным способом.
function playerLaunch(command, filePath, seconds, env = {}) {
  const expanded = String(command).replace(/%([A-Za-z_][\w()]*)%/g, (whole, name) => {
    const key = Object.keys(env).find(item => item.toLowerCase() === name.toLowerCase());
    return key ? env[key] : whole;
  });
  const [executable, ...rest] = splitCommandLine(expanded);
  if (!executable || !/\.exe$/i.test(executable.value)) return null;
  const start = playerStartArgs(executable.value, seconds);
  if (!start) return null;
  const args = [];
  let fileAdded = false;
  for (const token of rest) {
    if (/^%[1L]$/i.test(token.value)) { args.push(...(seconds > 0 ? start : []), filePath); fileAdded = true; }
    else if (!/^%[\d*~]/.test(token.value)) args.push(token.value);
  }
  if (!fileAdded) args.push(...(seconds > 0 ? start : []), filePath);
  return { executable: executable.value, args };
}

function safeNoteName(value) {
  return String(value).replace(/[<>:"/\\|?*#^[\]\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 120) || 'video';
}

function formatClockFull(value) {
  const total = Math.max(0, Math.floor(value));
  return [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60].map(part => String(part).padStart(2, '0')).join(':');
}

// Формат статьи повторяет заметки "video-note" в хранилище: frontmatter, "Аннотация", темы с таймкодами.
function buildObsidianArticle({ title, videoPath, duration, summary, frames, language = 'ru' }) {
  const lines = ['---', `title: ${JSON.stringify(title)}`, 'source_type: local-video', `source: ${JSON.stringify(fileLink(videoPath))}`, `language: ${language}`];
  if (Number.isFinite(duration) && duration > 0) lines.push(`duration: "${formatClockFull(duration)}"`);
  lines.push('tags:', '  - video-note', '---', `# ${title}`, '', `[Открыть видео](${videoLink(videoPath, 0)})`, '');
  if (frames.length) {
    lines.push('## Скриншоты', '', frames.map(frame => `![[${frame.file}|${frame.width || 180}]]`).join(' '), '', frames.map(frame => `[${formatClockFull(frame.time)}](${videoLink(videoPath, frame.time)})`).join(' · '), '');
  }
  lines.push('## Аннотация', '', summary.overview.trim(), '', '## Основные темы', '');
  if (!summary.topics.length) lines.push('Темы не выделены.', '');
  for (const topic of summary.topics) {
    const description = topic.description ? `  \n  ${topic.description.replace(/\s+/g, ' ')}` : '';
    lines.push(`- [${formatClock(topic.start)}](${videoLink(videoPath, topic.start)}) **${topic.title.replace(/\s+/g, ' ')}**${description}`);
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

// Блок для режима "Дополнить статью": добавляется в конец существующей заметки, остальное содержимое не трогается.
function buildObsidianAddendum({ videoPath, summary, date }) {
  const lines = ['', '---', '', `## Дополнение — ${date}`, '', summary.overview.trim(), '', '### Основные темы', ''];
  if (!summary.topics.length) lines.push('Темы не выделены.', '');
  for (const topic of summary.topics) {
    const description = topic.description ? `  \n  ${topic.description.replace(/\s+/g, ' ')}` : '';
    lines.push(`- [${formatClock(topic.start)}](${videoLink(videoPath, topic.start)}) **${topic.title.replace(/\s+/g, ' ')}**${description}`);
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

module.exports = { srtSegments, transcriptBatches, normalizeSummary, FRAME_COUNT, frameTimes, videoLink, parseVideoLink, encodePathPart, parseRegValue, playerLaunch, safeNoteName, buildObsidianArticle, buildObsidianAddendum };
