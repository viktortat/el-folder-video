const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../src/shared/published-date-core');

test('дата приводится к YYYY-MM-DD из форматов yt-dlp и страницы', () => {
  assert.equal(core.normalizePublishedDate('20251115'), '2025-11-15');
  assert.equal(core.normalizePublishedDate('2025-11-15'), '2025-11-15');
  assert.equal(core.normalizePublishedDate('2025-11-15T08:00:12-08:00'), '2025-11-15');
  assert.equal(core.normalizePublishedDate(' 2024-02-29 '), '2024-02-29');
});

test('некорректные даты отбрасываются', () => {
  for (const value of ['', null, undefined, 'вчера', '2025-02-30', '2025-13-01', '2025-00-10', '1999-01-01', '2025-11', '12345678']) {
    assert.equal(core.normalizePublishedDate(value), '', String(value));
  }
});

test('подпись даты как на YouTube', () => {
  assert.equal(core.formatPublishedDate('20251115'), '15 нояб. 2025 г.');
  assert.equal(core.formatPublishedDate('2024-03-01'), '1 мар. 2024 г.');
  assert.equal(core.formatPublishedDate('мусор'), '');
});

test('относительная подпись считается по календарю', () => {
  const now = new Date(2025, 10, 15);
  const cases = [
    ['2025-11-15', 'сегодня'], ['2025-11-14', 'вчера'], ['2025-11-12', '3 дня назад'], ['2025-11-09', '6 дней назад'],
    ['2025-11-08', '1 неделю назад'], ['2025-10-25', '3 недели назад'], ['2025-10-15', '1 месяц назад'],
    ['2025-08-10', '3 месяца назад'], ['2025-05-15', '6 месяцев назад'], ['2024-11-15', '1 год назад'],
    ['2023-06-01', '2 года назад'], ['2020-01-01', '5 лет назад'], ['2011-01-01', '14 лет назад'], ['2025-11-16', 'ещё не вышло']
  ];
  for (const [date, expected] of cases) assert.equal(core.relativePublishedDate(date, now), expected, date);
  assert.equal(core.relativePublishedDate('мусор', now), '');
});
