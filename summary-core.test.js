const { test } = require('node:test');
const assert = require('node:assert/strict');
const { srtSegments, transcriptBatches, normalizeSummary, frameTimes, videoLink, parseVideoLink, buildObsidianArticle, parseRegValue, playerLaunch } = require('./summary-core');

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

test('ссылка на видео с таймкодом разбирается обратно, скобки в пути экранируются', () => {
  const filePath = 'E:\\Видео (2025)\\урок 1.mp4';
  const link = videoLink(filePath, 62.9);
  assert.ok(!/[()\s]/.test(link));
  assert.deepEqual(parseVideoLink(link), { path: filePath, time: 62 });
  assert.deepEqual(parseVideoLink('folder-video://open/?path=C%3A%5Ca.mp4'), { path: 'C:\\a.mp4', time: 0 });
  assert.equal(parseVideoLink('https://example.com'), null);
});

test('моменты миниатюр совпадают с лентой списка: 10 кадров от начала до конца', () => {
  const times = frameTimes(90);
  assert.equal(times.length, 10);
  assert.equal(times[0], 0);
  assert.equal(times[1], 10);
  assert.ok(Math.abs(times[9] - 89.9) < 1e-9);
});

test('статья Obsidian содержит миниатюры, аннотацию и темы со ссылками на таймкоды', () => {
  const article = buildObsidianArticle({
    title: 'Урок', videoPath: 'E:\\v\\урок.mp4', duration: 3598,
    summary: { overview: 'Описание видео', topics: [{ title: 'Первая тема', description: 'О чём она', start: 8 }] },
    frames: [{ time: 0, file: 'Урок_a_01.jpg' }, { time: 10, file: 'Урок_a_02.jpg' }]
  });
  assert.match(article, /^---\ntitle: "Урок"\n/);
  assert.match(article, /duration: "00:59:58"/);
  assert.match(article, /\nsource: "file:\/\/\/E:\/v\/урок\.mp4"\n/);
  assert.ok(article.indexOf('## Скриншоты') < article.indexOf('## Аннотация'));
  assert.ok(article.indexOf('## Аннотация') < article.indexOf('## Основные темы'));
  assert.match(article, /!\[\[Урок_a_01\.jpg\|180\]\] !\[\[Урок_a_02\.jpg\|180\]\]/);
  assert.match(article, /\[00:00:10\]\(folder-video:\/\/open\?path=[^)]+&t=10\)/);
  assert.match(article, /- \[0:08\]\(folder-video:\/\/open\?path=[^)]+&t=8\) \*\*Первая тема\*\*  \n  О чём она/);
});

test('системный плеер из реестра запускается с нужной секунды', () => {
  const command = parseRegValue('\r\nHKEY_CLASSES_ROOT\\VLC.mp4\\shell\\open\\command\r\n    (По умолчанию)    REG_SZ    "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe" --started-from-file "%1"\r\n\r\n');
  assert.equal(command, '"C:\\Program Files\\VideoLAN\\VLC\\vlc.exe" --started-from-file "%1"');
  assert.deepEqual(playerLaunch(command, 'D:\\v (1).mp4', 73.6), {
    executable: 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
    args: ['--started-from-file', '--start-time=73', 'D:\\v (1).mp4']
  });
  assert.deepEqual(playerLaunch('%ProgramFiles%\\MPC-HC\\mpc-hc64.exe "%1" %*', 'a.mp4', 5, { PROGRAMFILES: 'C:\\PF' }), {
    executable: 'C:\\PF\\MPC-HC\\mpc-hc64.exe', args: ['/start', '5000', 'a.mp4']
  });
  assert.equal(playerLaunch('"C:\\x\\unknown.exe" "%1"', 'a.mp4', 5), null);
  assert.equal(playerLaunch('', 'a.mp4', 5), null);
});
