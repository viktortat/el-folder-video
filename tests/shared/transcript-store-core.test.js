const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../../src/shared/transcript-store-core');

const fixture = name => path.join(__dirname, '..', 'fixtures', 'transcript-store', name);
const json = name => JSON.parse(fs.readFileSync(fixture(name), 'utf8'));
const signature = { filePath: 'D:\\video\\lecture.mp4', size: 1000, mtimeMs: 1700000000000 };

test('имя файлов локального видео: безопасное имя и 12 символов хэша пути', () => {
  assert.equal(core.fileStem('D:\\a\\b:c?.mp4', 'abcdef0123456789'), 'b_c___abcdef012345');
  assert.equal(core.fileStem('/x/видео.mkv', '0123456789abcdef'), 'видео__0123456789ab');
  assert.equal(core.fileStem('.mp4', '0123456789abcdef'), '.mp4__0123456789ab');
});

test('имя файлов ролика YouTube — yt-<id>, чужой формат отклоняется', () => {
  assert.equal(core.youtubeStem('dQw4w9WgXcQ'), 'yt-dQw4w9WgXcQ');
  assert.throws(() => core.youtubeStem('../evil'));
  assert.equal(core.isYoutubeId('short'), false);
});

test('манифест v1 читается и нормализуется', () => {
  const m = core.readManifest(json('manifest-v1.json'));
  assert.equal(m.version, 1);
  assert.deepEqual(m.source, { kind: 'file', path: signature.filePath, size: 1000, mtimeMs: 1700000000000 });
  assert.equal(m.transcript.model, 'parakeet-tdt-0.6b-v3-Q8_0.gguf');
});

test('манифест v2 читается; мусор даёт null', () => {
  assert.equal(core.readManifest(json('manifest-v2-file.json')).transcript.createdBy, 'okoshko');
  assert.equal(core.readManifest(json('manifest-v2-youtube.json')).source.id, 'dQw4w9WgXcQ');
  assert.equal(core.readManifest(null), null);
  assert.equal(core.readManifest({ foo: 1 }), null);
});

test('актуальность транскрипции зависит только от видео, не от модели и приложения', () => {
  assert.equal(core.isTranscriptFresh(json('manifest-v1.json'), signature), true);
  assert.equal(core.isTranscriptFresh(json('manifest-v2-file.json'), signature), true);
  assert.equal(core.isTranscriptFresh(json('manifest-v2-file.json'), { ...signature, size: 1001 }), false);
  assert.equal(core.isTranscriptFresh(json('manifest-v2-file.json'), { ...signature, mtimeMs: 1 }), false);
  assert.equal(core.isTranscriptFresh(json('manifest-v2-file.json'), { ...signature, filePath: 'D:\\other.mp4' }), false);
  assert.equal(core.isTranscriptFresh(json('manifest-v2-youtube.json'), signature), false);
});

test('актуальность сводки зависит только от хэша транскрипции', () => {
  const saved = json('sample.summary.json');
  assert.equal(core.isSummaryFresh(saved, 'abc'), true);
  assert.equal(core.isSummaryFresh(saved, 'other'), false);
  assert.equal(core.isSummaryFresh(null, 'abc'), false);
});

test('сборка манифеста v2 хранит только имя модели', () => {
  const m = core.buildManifest({ source: core.fileManifestSource({ ...signature, sha256: 'ff' }), model: 'C:\\m\\x.gguf', createdBy: 'folder-video', createdAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(m.version, 2);
  assert.equal(m.transcript.model, 'x.gguf');
  assert.equal(m.source.sha256, 'ff');
  assert.equal(core.readManifest(m).transcript.createdBy, 'folder-video');
});

test('lock: живой процесс удерживает, мёртвый и старый — протухают', () => {
  const now = Date.parse('2026-11-12T11:00:00.000Z');
  assert.equal(core.isLockStale(json('live.lock'), now, () => true), false);
  assert.equal(core.isLockStale(json('live.lock'), now, () => false), true);
  assert.equal(core.isLockStale(json('stale.lock'), now, () => true), true);
  assert.equal(core.isLockStale({ app: 'x' }, now, () => true), true);
  assert.equal(core.isLockStale(null, now), true);
});

test('слова собираются во фразы по паузе, длине и знаку конца предложения', () => {
  const w = (start, end, text) => ({ start, end, text });
  assert.deepEqual(core.wordsToPhrases([w(0, 1, 'Привет'), w(1, 2, 'мир.'), w(2, 3, 'Дальше'), w(5, 6, 'после'), w(6, 7, 'паузы')]), [
    { start: 0, end: 2, text: 'Привет мир.' },
    { start: 2, end: 3, text: 'Дальше' },
    { start: 5, end: 7, text: 'после паузы' }
  ]);
  const long = Array.from({ length: 40 }, (_, i) => w(i, i + 0.9, 'слово'));
  const phrases = core.wordsToPhrases(long);
  assert.ok(phrases.length > 1);
  assert.ok(phrases.every(p => p.end - p.start <= 31));
  assert.deepEqual(core.wordsToPhrases([]), []);
});

test('SRT совпадает с форматом прежнего скрипта и с эталонным файлом', () => {
  const srt = core.toSrt([{ start: 0, end: 2.5, text: 'Первая фраза.' }, { start: 3, end: 5, text: 'Вторая фраза.' }]);
  assert.equal(srt, fs.readFileSync(fixture('sample.srt'), 'utf8'));
  assert.equal(core.srtTime(3723.456), '01:02:03,456');
});
