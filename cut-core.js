"use strict";

// Чистая логика вырезки фрагментов: диапазоны, привязка к ключевым кадрам, аргументы ffmpeg.
// Без Node.js-API, чтобы модуль можно было подключать и в main, и в renderer.

const MIN_RANGE_SECONDS = 0.05;
const MIN_REMAINDER_SECONDS = 1;

function finite(value) { return typeof value === 'number' && Number.isFinite(value); }

// Сортирует, обрезает по длительности и сливает пересекающиеся и соприкасающиеся диапазоны.
function normalizeRanges(ranges, duration) {
  const limit = finite(duration) && duration > 0 ? duration : Infinity;
  const list = (Array.isArray(ranges) ? ranges : [])
    .map(range => ({ start: Math.max(0, Math.min(Number(range && range.start), limit)), end: Math.max(0, Math.min(Number(range && range.end), limit)) }))
    .filter(range => finite(range.start) && finite(range.end) && range.end - range.start >= MIN_RANGE_SECONDS)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  list.forEach(range => {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ start: range.start, end: range.end });
  });
  return merged;
}

// Ключевые кадры: удаляемый диапазон заканчивается на ближайшем ключевом кадре не позже заданного конца,
// чтобы остаток начинался с чистого кадра и не терялось то, что пользователь не отмечал.
// Диапазон, в который не попадает ни один ключевой кадр после начала, пропускается.
function snapRangesToKeyframes(ranges, keyframes, duration) {
  const frames = (Array.isArray(keyframes) ? keyframes : []).filter(finite).sort((a, b) => a - b);
  const snapped = [];
  const skipped = [];
  normalizeRanges(ranges, duration).forEach(range => {
    if (finite(duration) && range.end >= duration - 1e-3) { snapped.push({ start: range.start, end: duration, requestedEnd: range.end }); return; }
    let end = null;
    for (let index = frames.length - 1; index >= 0; index--) if (frames[index] <= range.end + 1e-3) { end = frames[index]; break; }
    if (end === null || end - range.start < MIN_RANGE_SECONDS) skipped.push(range);
    else snapped.push({ start: range.start, end, requestedEnd: range.end });
  });
  return { ranges: normalizeRanges(snapped, duration).map(range => ({ start: range.start, end: range.end })), skipped };
}

// Оставляемые отрезки между удаляемыми диапазонами.
function keepSegments(ranges, duration) {
  const keep = [];
  let cursor = 0;
  normalizeRanges(ranges, duration).forEach(range => {
    if (range.start > cursor + 1e-3) keep.push({ start: cursor, end: range.start });
    cursor = Math.max(cursor, range.end);
  });
  if (duration - cursor > 1e-3) keep.push({ start: cursor, end: duration });
  return keep;
}

function removedSeconds(ranges) { return ranges.reduce((sum, range) => sum + (range.end - range.start), 0); }

function remainderSeconds(ranges, duration) { return duration - removedSeconds(normalizeRanges(ranges, duration)); }

// Проверка перед запуском: есть длительность, есть что вырезать, остаётся хотя бы секунда.
function validateCut(ranges, duration) {
  if (!finite(duration) || duration <= 0) return 'Не удалось определить длительность видео.';
  const normalized = normalizeRanges(ranges, duration);
  if (!normalized.length) return 'Не выбрано ни одного фрагмента для вырезки.';
  if (remainderSeconds(normalized, duration) < MIN_REMAINDER_SECONDS) return 'После вырезки должно остаться хотя бы 1 секунда видео.';
  return null;
}

// Время в исходном файле → время в новом. Для времени внутри вырезанного возвращает null.
function remapTime(ranges, seconds) {
  let shift = 0;
  for (const range of ranges) {
    if (seconds >= range.end) shift += range.end - range.start;
    else if (seconds >= range.start) return null;
    else break;
  }
  return seconds - shift;
}

function listFileValue(filePath) {
  // Демультиплексор concat читает пути в одинарных кавычках; обратные слэши Windows заменяем прямыми.
  return `'${String(filePath).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;
}

function buildConcatList(inputPath, segments) {
  return segments.map(segment => `file ${listFileValue(inputPath)}\ninpoint ${segment.start.toFixed(3)}\noutpoint ${segment.end.toFixed(3)}\n`).join('');
}

const FASTSTART_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov']);

const MUXER_FORMATS = { '.mp4': 'mp4', '.m4v': 'mp4', '.mov': 'mov', '.mkv': 'matroska', '.webm': 'webm', '.avi': 'avi', '.ogv': 'ogg' };

// Результат пишется во временный файл без видеорасширения, поэтому формат контейнера задаётся явно.
function containerArguments(extension) {
  const lower = String(extension).toLowerCase();
  return [...(FASTSTART_EXTENSIONS.has(lower) ? ['-movflags', '+faststart'] : []), ...(MUXER_FORMATS[lower] ? ['-f', MUXER_FORMATS[lower]] : [])];
}

// Тот же выбор кодеков, что у ускорения: формат контейнера остаётся прежним.
function reencodeCodecArguments(extension) {
  switch (String(extension).toLowerCase()) {
    case '.webm': return ['-c:v', 'libvpx-vp9', '-c:a', 'libopus'];
    case '.ogv': return ['-c:v', 'libtheora', '-c:a', 'libvorbis'];
    case '.avi': return ['-c:v', 'mpeg4', '-c:a', 'libmp3lame'];
    default: return ['-c:v', 'libx264', '-c:a', 'aac'];
  }
}

// Параметры качества при перекодировании: близко к исходному, без изменения разрешения и частоты кадров.
function cutQualityArguments(extension) {
  switch (String(extension).toLowerCase()) {
    case '.webm': return ['-crf', '24', '-b:v', '0'];
    case '.ogv': return ['-q:v', '8', '-q:a', '6'];
    case '.avi': return ['-q:v', '2', '-q:a', '2'];
    default: return ['-crf', '18', '-preset', 'veryfast'];
  }
}

// Склейка без перекодирования: вход — список concat с inpoint/outpoint.
function buildCopyArguments(listFile, outputPath, extension) {
  return ['-hide_banner', '-nostats', '-progress', 'pipe:1', '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-map', '0:v?', '-map', '0:a?', '-map', '0:s?', '-map_metadata', '0', '-map_chapters', '-1', '-c', 'copy', ...containerArguments(extension), outputPath];
}

function seconds(value) { return Number(value.toFixed(3)).toString(); }

function removedExpression(ranges) {
  return ranges.map(range => `gte(t,${seconds(range.start)})*lt(t,${seconds(range.end)})`).join('+');
}

// Сдвиг времени после вырезки: сумма длин уже пройденных вырезанных диапазонов.
function shiftExpression(ranges) {
  return ranges.map(range => `gte(T,${seconds(range.end)})*${seconds(range.end - range.start)}`).join('+');
}

// Точная вырезка с перекодированием: кадры отбираются по времени, остальные сдвигаются.
function buildReencodeArguments(inputPath, outputPath, ranges, extension) {
  const dropped = removedExpression(ranges);
  const shift = shiftExpression(ranges);
  return ['-hide_banner', '-nostats', '-progress', 'pipe:1', '-y', '-i', inputPath,
    '-map', '0:v?', '-map', '0:a?', '-map', '0:s?', '-map_metadata', '0', '-map_chapters', '-1',
    '-filter:v', `select='not(${dropped})',setpts='PTS-(${shift})/TB'`,
    '-filter:a', `aselect='not(${dropped})',asetpts='PTS-(${shift})/TB'`,
    ...reencodeCodecArguments(extension), ...cutQualityArguments(extension), '-c:s', 'copy', ...containerArguments(extension), outputPath];
}

function formatClock(secondsValue) {
  const total = Math.max(0, secondsValue);
  const whole = Math.floor(total);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const tenths = Math.floor((total - whole) * 10);
  const rest = `${String(whole % 60).padStart(2, '0')}.${tenths}`;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${String(minutes).padStart(2, '0')}:${rest}`;
}

// Видимое окно полосы вырезки: {start, span} в секундах.
const MIN_VIEW_SPAN = 0.5;

function clampView(view, duration) {
  const span = Math.min(duration, Math.max(Math.min(MIN_VIEW_SPAN, duration), view.span));
  const start = Math.min(Math.max(0, duration - span), Math.max(0, view.start));
  return { start, span };
}

function fullView(duration) { return { start: 0, span: duration }; }

// Масштаб вокруг секунды anchor: она остаётся на том же месте полосы. factor < 1 — приближение.
function zoomView(view, factor, anchor, duration) {
  const span = Math.min(duration, Math.max(Math.min(MIN_VIEW_SPAN, duration), view.span * factor));
  const fraction = view.span > 0 ? (anchor - view.start) / view.span : 0.5;
  return clampView({ start: anchor - fraction * span, span }, duration);
}

// Если секунда вне окна, сдвигает окно так, чтобы она оказалась ближе к левому краю; иначе не меняет.
function revealView(view, seconds, duration) {
  if (seconds >= view.start && seconds <= view.start + view.span) return view;
  return clampView({ start: seconds - view.span * 0.1, span: view.span }, duration);
}

// Окно, в которое помещается отрезок [a, b] с небольшими полями.
function viewForRange(a, b, duration) {
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  const pad = Math.max((high - low) * 0.1, 0.05);
  return clampView({ start: low - pad, span: high - low + pad * 2 }, duration);
}

const cutCore = {
  MIN_VIEW_SPAN, clampView, fullView, zoomView, revealView, viewForRange,
  MIN_RANGE_SECONDS, MIN_REMAINDER_SECONDS, normalizeRanges, snapRangesToKeyframes, keepSegments, removedSeconds, remainderSeconds,
  validateCut, remapTime, buildConcatList, reencodeCodecArguments, buildCopyArguments, buildReencodeArguments, formatClock
};
if (typeof module !== 'undefined' && module.exports) module.exports = cutCore;
else globalThis.CutCore = cutCore;
