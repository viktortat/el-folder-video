const { test } = require('node:test');
const assert = require('node:assert/strict');
const { srtSegments, transcriptBatches, normalizeSummary } = require('./summary-core');

test('темы получают таймкоды только существующих сегментов SRT', () => {
  const segments = srtSegments('1\n00:00:08,500 --> 00:00:10,000\nНачало\n\n2\n00:11:02,250 --> 00:11:05,000\nВторая тема\n');
  const result = normalizeSummary({ overview: 'Краткая сводка', topics: [
    { title: 'Поздняя тема', segmentIndex: 2 },
    { title: 'Несуществующая тема', segmentIndex: 99 },
    { title: 'Начало', segmentIndex: 1 },
    { title: 'Дубль', segmentIndex: 2 }
  ] }, segments, new Set([1, 2]));
  assert.deepEqual(result.topics.map(topic => [topic.title, topic.start]), [['Начало', 8.5], ['Поздняя тема', 662.25]]);
});

test('длинный транскрипт делится на части с исходными номерами сегментов', () => {
  const segments = Array.from({ length: 100 }, (_, index) => ({ start: index * 10, text: 'слово '.repeat(150) }));
  const batches = transcriptBatches(segments);
  assert.ok(batches.length > 1);
  assert.equal(batches.flat().length, segments.length);
  assert.ok(batches[0][0].startsWith('[1]'));
  assert.ok(batches.at(-1).at(-1).startsWith('[100]'));
});
