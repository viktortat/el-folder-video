"use strict";

// Дата публикации ролика на YouTube: нормализация, подпись и «сколько назад». Без Node.js-API,
// загружается и в main через require, и в renderer через <script>.

const MIN_YEAR = 2005;
const MAX_YEAR = 2100;

// "20251115", "2025-11-15", "2025-11-15T08:00:12-08:00" -> "2025-11-15"; иначе "".
// Календарная часть берётся как есть: именно её показывает сам YouTube.
function normalizePublishedDate(value) {
  const text = String(value == null ? '' : value).trim();
  const match = /^(\d{4})-?(\d{2})-?(\d{2})(?:$|[T\s])/.exec(text);
  if (!match) return '';
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1) return '';
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return '';
  return `${match[1]}-${match[2]}-${match[3]}`;
}

// "2025-11-15" -> "15 нояб. 2025 г." (как под роликом на YouTube).
function formatPublishedDate(value) {
  const date = normalizePublishedDate(value);
  if (!date) return '';
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day)));
}

function pluralRu(count, forms) {
  const tail = count % 100; const last = count % 10;
  if (tail >= 11 && tail <= 14) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}

// "2025-11-15" -> "3 месяца назад"; now — локальная дата «сегодня» (Date), для тестов.
function relativePublishedDate(value, now = new Date()) {
  const date = normalizePublishedDate(value);
  if (!date) return '';
  const [year, month, day] = date.split('-').map(Number);
  const today = { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  const days = Math.round((Date.UTC(today.year, today.month - 1, today.day) - Date.UTC(year, month - 1, day)) / 86400000);
  if (days < 0) return 'ещё не вышло';
  if (days === 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} ${pluralRu(days, ['день', 'дня', 'дней'])} назад`;
  const months = (today.year - year) * 12 + (today.month - month) - (today.day < day ? 1 : 0);
  if (months < 1) { const weeks = Math.floor(days / 7); return `${weeks} ${pluralRu(weeks, ['неделю', 'недели', 'недель'])} назад`; }
  if (months < 12) return `${months} ${pluralRu(months, ['месяц', 'месяца', 'месяцев'])} назад`;
  const years = Math.floor(months / 12);
  return `${years} ${pluralRu(years, ['год', 'года', 'лет'])} назад`;
}

const publishedDateCore = { normalizePublishedDate, formatPublishedDate, relativePublishedDate };
if (typeof module !== 'undefined' && module.exports) module.exports = publishedDateCore;
else globalThis.PublishedDateCore = publishedDateCore;
