"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createTranscriptStore } = require('../../src/main/transcript-store');
const core = require('../../src/shared/transcript-store-core');

function setup(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-store-'));
  const dir = path.join(root, 'tr');
  fs.mkdirSync(dir);
  fs.mkdirSync(path.join(root, 'sub'));
  const store = createTranscriptStore({ getDirectory: () => dir, unmigratedFile: path.join(root, 'unmigrated.json'), ...options });
  return { root, dir, store };
}

function makeVideo(file, content = 'video', mtimeMs = 1700000000000) {
  fs.writeFileSync(file, content);
  const time = new Date(mtimeMs);
  fs.utimesSync(file, time, time);
  return fs.lstatSync(file);
}

const sha = content => createHash('sha256').update(content).digest('hex');

// Набор файлов со старым именем (по хэшу пути), как его создавали прежние версии.
function writeLegacy(store, dir, filePath, stat, withNotes = true) {
  const stem = store.legacyStemFor(filePath);
  fs.writeFileSync(path.join(dir, `${stem}.srt`), '1\n00:00:00,000 --> 00:00:01,000\nпривет\n');
  fs.writeFileSync(path.join(dir, `${stem}.txt`), 'привет\n');
  fs.writeFileSync(path.join(dir, `${stem}.json`), JSON.stringify({ filePath, size: stat.size, mtimeMs: stat.mtimeMs, modelPath: 'm.gguf' }));
  if (withNotes) fs.writeFileSync(path.join(dir, `${stem}.notes.md`), '[0:01]\nзаметка\n');
  return stem;
}

test('старый набор (имя по хэшу пути) переименовывается в file-<хэш содержимого>', async () => {
  const { root, dir, store } = setup();
  const file = path.join(root, 'a.mp4');
  const stat = makeVideo(file);
  const legacy = writeLegacy(store, dir, file, stat);
  const result = await store.readOwn(file, stat);
  assert.equal(result.available, true);
  assert.equal(result.stem, `file-${sha('video').slice(0, 16)}`);
  assert.equal(fs.existsSync(path.join(dir, `${legacy}.srt`)), false);
  assert.equal(fs.readFileSync(store.paths(file).notesPath, 'utf8'), '[0:01]\nзаметка\n');
  const manifest = JSON.parse(fs.readFileSync(store.paths(file).manifestPath, 'utf8'));
  assert.equal(manifest.version, 3);
  assert.equal(manifest.source.sha256, sha('video'));
});

test('перенос видео: набор находится по содержимому, старого пути уже нет', async () => {
  const { root, dir, store } = setup();
  const oldPath = path.join(root, 'a.mp4');
  const stat = makeVideo(oldPath);
  writeLegacy(store, dir, oldPath, stat);
  const newPath = path.join(root, 'sub', 'a.mp4');
  fs.renameSync(oldPath, newPath);
  const result = await store.readOwn(newPath, fs.lstatSync(newPath));
  assert.equal(result.available, true);
  assert.equal(JSON.parse(fs.readFileSync(store.paths(newPath).manifestPath, 'utf8')).source.path, newPath);
});

test('старая копия на месте: набор не уводится', async () => {
  const { root, dir, store } = setup();
  const oldPath = path.join(root, 'a.mp4');
  const stat = makeVideo(oldPath);
  const legacy = writeLegacy(store, dir, oldPath, stat);
  const copy = path.join(root, 'sub', 'a.mp4');
  const result = await store.readOwn(copy, makeVideo(copy));
  assert.equal(result.available, false);
  assert.equal(fs.existsSync(path.join(dir, `${legacy}.notes.md`)), true);
});

test('существующие файлы нового имени не перезаписываются, набор попадает в список неперенесённых', async () => {
  const { root, dir, store } = setup();
  const file = path.join(root, 'a.mp4');
  const stat = makeVideo(file);
  const legacy = writeLegacy(store, dir, file, stat);
  fs.writeFileSync(path.join(dir, `file-${sha('video').slice(0, 16)}.notes.md`), 'новые');
  await store.readOwn(file, stat);
  assert.equal(fs.readFileSync(store.paths(file).notesPath, 'utf8'), 'новые');
  const list = await store.listUnmigrated();
  assert.equal(list.length, 1);
  assert.equal(list[0].stem, legacy);
  assert.match(list[0].reason, /уже есть файлы/);
});

test('код ролика в имени файла: оригинал — yt-<код>, копия — yt-<код>.<вариант>', async () => {
  const { root, store } = setup();
  const original = path.join(root, 'Название [dQw4w9WgXcQ].mp4');
  const copy = path.join(root, 'Название [dQw4w9WgXcQ] (RU)_2x.mp4');
  assert.equal((await store.prepare(original, makeVideo(original, 'a'))).stem, 'yt-dQw4w9WgXcQ');
  assert.equal((await store.prepare(copy, makeVideo(copy, 'b'))).stem, 'yt-dQw4w9WgXcQ.RU_2x');
});

test('метаданные файла имеют приоритет над именем, вариант берётся из метаданных', async () => {
  const { root, dir } = setup();
  const store = createTranscriptStore({ getDirectory: () => dir, getSourceInfo: async () => ({ youtubeId: 'AAAAAAAAAAA', variant: core.parseVariantLabel('UK_1.5x') }) });
  const file = path.join(root, 'x [BBBBBBBBBBB].mp4');
  assert.equal((await store.prepare(file, makeVideo(file))).stem, 'yt-AAAAAAAAAAA.UK_1.5x');
});

test('код ролика стал известен позже: набор file-<хэш> переименовывается в yt-<код>', async () => {
  const { root, dir } = setup();
  let id = '';
  const store = createTranscriptStore({ getDirectory: () => dir, getSourceInfo: async () => (id ? { youtubeId: id } : null) });
  const file = path.join(root, 'v.mp4');
  const stat = makeVideo(file);
  await store.write(file, stat, [{ start: 0, end: 1, text: 'один' }], 'm.gguf');
  const before = store.paths(file).stem;
  assert.match(before, /^file-/);
  id = 'dQw4w9WgXcQ';
  store.forget(file);
  const result = await store.readOwn(file, stat);
  assert.equal(result.available, true);
  assert.equal(result.stem, 'yt-dQw4w9WgXcQ');
  assert.equal(fs.existsSync(path.join(dir, `${before}.srt`)), false);
});

test('транскрипция ролика от Radar подходит видео без изменений', async () => {
  const { root, dir, store } = setup();
  const file = path.join(root, 'Ролик [dQw4w9WgXcQ].mp4');
  const stat = makeVideo(file);
  fs.writeFileSync(path.join(dir, 'yt-dQw4w9WgXcQ.srt'), '1\n00:00:00,000 --> 00:00:01,000\nhello\n');
  fs.writeFileSync(path.join(dir, 'yt-dQw4w9WgXcQ.json'), JSON.stringify({ version: 2, source: { kind: 'youtube', id: 'dQw4w9WgXcQ', url: '', title: '' }, transcript: {}, translations: {} }));
  const result = await store.readOwn(file, stat);
  assert.equal(result.available, true);
  assert.equal(result.fromYoutube, true);
});

test('один и тот же файл по разным путям — один набор', async () => {
  const { root, store } = setup();
  const a = path.join(root, 'a.mp4');
  const b = path.join(root, 'sub', 'b.mp4');
  const first = await store.prepare(a, makeVideo(a, 'same'));
  const second = await store.prepare(b, makeVideo(b, 'same'));
  assert.equal(first.stem, second.stem);
});

test('перенос всех: видео найдено — набор переименован, не найдено — в список; «Указать видео» достраивает', async () => {
  const { root, dir, store } = setup();
  const present = path.join(root, 'p.mp4');
  const presentStat = makeVideo(present, 'present');
  writeLegacy(store, dir, present, presentStat, false);
  const gone = path.join(root, 'gone.mp4');
  const goneStat = makeVideo(gone, 'gone-content');
  const goneStem = writeLegacy(store, dir, gone, goneStat, false);
  const moved = path.join(root, 'sub', 'gone.mp4');
  fs.renameSync(gone, moved);
  const result = await store.migrateAll();
  assert.equal(result.total, 2);
  assert.equal(fs.existsSync(path.join(dir, `file-${sha('present').slice(0, 16)}.srt`)), true);
  const list = await store.listUnmigrated();
  assert.deepEqual(list.map(item => item.stem), [goneStem]);
  const adopted = await store.adoptUnmigrated(goneStem, moved);
  assert.equal(adopted.success, true);
  assert.equal(fs.existsSync(path.join(dir, `file-${sha('gone-content').slice(0, 16)}.srt`)), true);
  assert.deepEqual(await store.listUnmigrated(), []);
});

test('«Указать видео»: другой размер отклоняется', async () => {
  const { root, dir, store } = setup();
  const gone = path.join(root, 'gone.mp4');
  const stem = writeLegacy(store, dir, gone, { size: 1000, mtimeMs: 1 }, false);
  await store.migrateAll();
  const other = path.join(root, 'o.mp4');
  makeVideo(other, 'коротко');
  const result = await store.adoptUnmigrated(stem, other);
  assert.match(result.error, /Размер/);
});

test('кэш хэшей: повторное открытие не читает файл заново', async () => {
  const { root, dir } = setup();
  let reads = 0;
  const cacheFile = path.join(root, 'cache.json');
  const store = createTranscriptStore({ getDirectory: () => dir, cacheFile, hashFile: async file => { reads++; return sha(fs.readFileSync(file)); } });
  const file = path.join(root, 'a.mp4');
  const stat = makeVideo(file);
  await store.prepare(file, stat);
  store.forget(file);
  await store.prepare(file, stat);
  assert.equal(reads, 1);
  const again = createTranscriptStore({ getDirectory: () => dir, cacheFile, hashFile: async () => { reads++; return ''; } });
  await again.prepare(file, stat);
  assert.equal(reads, 1);
});
