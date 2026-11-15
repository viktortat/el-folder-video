const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../src/main/youtube-link-core');

test('из названия убираются расширение, язык дубляжа и коэффициент ускорения', () => {
  assert.equal(core.cleanSearchTitle('Мой урок (RU)_2x.mp4'), 'Мой урок');
  assert.equal(core.cleanSearchTitle('Lesson (ru)_1.5x'), 'Lesson');
  assert.equal(core.cleanSearchTitle('Lesson_2x.mkv'), 'Lesson');
  assert.equal(core.cleanSearchTitle('Видео (2024) часть 2'), 'Видео (2024) часть 2');
  assert.equal(core.cleanSearchTitle(''), '');
});

test('открывать и записывать можно только ссылки на ролики YouTube', () => {
  assert.equal(core.isYouTubeVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), true);
  assert.equal(core.isYouTubeVideoUrl('https://youtu.be/dQw4w9WgXcQ'), true);
  assert.equal(core.isYouTubeVideoUrl('https://www.youtube.com/'), false);
  assert.equal(core.isYouTubeVideoUrl('http://www.youtube.com/watch?v=dQw4w9WgXcQ'), false);
  assert.equal(core.isYouTubeVideoUrl('https://evil.com/watch?v=dQw4w9WgXcQ'), false);
  assert.equal(core.isYouTubeVideoUrl(''), false);
  assert.equal(core.isYouTubeVideoUrl(null), false);
});

test('длительность из выдачи разбирается в секунды', () => {
  assert.equal(core.parseClockDuration('12:34'), 754);
  assert.equal(core.parseClockDuration('1:02:03'), 3723);
  assert.equal(core.parseClockDuration('LIVE'), null);
});

test('разбор страницы поиска даёт кандидатов с каноническими ссылками', () => {
  const data = { contents: [{ videoRenderer: { videoId: 'dQw4w9WgXcQ', title: { runs: [{ text: 'Один' }] }, ownerText: { runs: [{ text: 'Канал' }] }, lengthText: { simpleText: '3:33' } } },
    { x: { videoRenderer: { videoId: 'dQw4w9WgXcQ', title: { simpleText: 'Дубль' } } } },
    { videoRenderer: { videoId: 'bad', title: { simpleText: 'Плохой id' } } },
    { videoRenderer: { videoId: 'aaaaaaaaaaa', title: { simpleText: 'Два {скобки} "кавычки"' }, lengthText: { simpleText: '10:00' } } }] };
  const html = '<script>var ytInitialData = ' + JSON.stringify(data) + ';</script>';
  const result = core.parseSearchHtml(html);
  assert.deepEqual(result.map(item => item.id), ['dQw4w9WgXcQ', 'aaaaaaaaaaa']);
  assert.equal(result[0].url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(result[0].duration, 213);
  assert.equal(result[1].title, 'Два {скобки} "кавычки"');
  assert.deepEqual(core.parseSearchHtml('<html></html>'), []);
});

test('разбор вывода yt-dlp пропускает мусорные строки', () => {
  const output = '{"id":"dQw4w9WgXcQ","title":"A","channel":"C","duration":213.4}\nnot json\n{"id":"x","title":"B"}\n';
  const result = core.parseYtDlpOutput(output);
  assert.equal(result.length, 1);
  assert.equal(result[0].duration, 213);
});

test('автовыбор срабатывает только при совпадении длительности в пределах допуска', () => {
  const candidates = [{ id: 'aaaaaaaaaaa', duration: 100 }, { id: 'bbbbbbbbbbb', duration: 600 }, { id: 'ccccccccccc', duration: null }];
  assert.equal(core.pickAutoCandidate(candidates, 601.5).id, 'bbbbbbbbbbb');
  assert.equal(core.pickAutoCandidate(candidates, 603), null);
  assert.equal(core.pickAutoCandidate(candidates, NaN), null);
  assert.equal(core.pickAutoCandidate([], 100), null);
});

test('запись свойства поддерживается только для mp4, m4v и mov', () => {
  assert.equal(core.isWritableExtension('.MP4'), true);
  assert.equal(core.isWritableExtension('.mkv'), false);
});

test('дата публикации берётся из вывода yt-dlp', () => {
  assert.equal(core.parseYtDlpUploadDate('{"id":"dQw4w9WgXcQ","upload_date":"20251115"}\n'), '2025-11-15');
  assert.equal(core.parseYtDlpUploadDate('предупреждение\n{"id":"x","release_date":"20240229"}'), '2024-02-29');
  assert.equal(core.parseYtDlpUploadDate('{"timestamp":1763164800}'), '2025-11-14');
  assert.equal(core.parseYtDlpUploadDate('{"timestamp":1256490000,"upload_date":"20091025"}'), '2009-10-25');
  assert.equal(core.parseYtDlpUploadDate('{"timestamp":1256451600,"upload_date":"20091025"}'), '2009-10-24');
  assert.equal(core.parseYtDlpUploadDate('{"upload_date":null}'), '');
  assert.equal(core.parseYtDlpUploadDate(''), '');
});

test('дата публикации берётся со страницы ролика', () => {
  assert.equal(core.parsePageDate('<meta itemprop="datePublished" content="2025-11-15T08:00:12-08:00">'), '2025-11-15');
  assert.equal(core.parsePageDate('<meta content="2023-01-31" itemprop="datePublished">'), '2023-01-31');
  assert.equal(core.parsePageDate('{"microformat":{"playerMicroformatRenderer":{"publishDate":"2022-07-04T01:02:03-07:00"}}}'), '2022-07-04');
  assert.equal(core.parsePageDate('{"uploadDate":"2021-12-25"}'), '2021-12-25');
  assert.equal(core.parsePageDate('<html></html>'), '');
});
