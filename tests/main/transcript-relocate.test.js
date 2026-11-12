"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTranscriptStore } = require('../../src/main/transcript-store');
const core = require('../../src/shared/transcript-store-core');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-relocate-'));
  const store = createTranscriptStore({ getDirectory: () => path.join(root, 'tr') });
  fs.mkdirSync(path.join(root, 'tr'));
  fs.mkdirSync(path.join(root, 'sub'));
  return { root, store };
}

function makeVideo(file, mtimeMs) {
  fs.writeFileSync(file, 'video');
  const time = new Date(mtimeMs);
  fs.utimesSync(file, time, time);
  return fs.lstatSync(file);
}

async function writeOld(store, oldPath, stat) {
  await store.write(oldPath, stat, [{ start: 0, end: 1, text: 'привет' }], 'model.gguf');
  const p = store.paths(oldPath);
  fs.writeFileSync(p.notesPath, '[0:01]\nзаметка\n');
  return p;
}

test('перенос видео: транскрипция и заметки находятся по новому пути', async () => {
  const { root, store } = setup();
  const oldPath = path.join(root, 'a.mp4');
  const stat = makeVideo(oldPath, 1700000000000);
  const old = await writeOld(store, oldPath, stat);
  const newPath = path.join(root, 'sub', 'a.mp4');
  fs.renameSync(oldPath, newPath);
  const result = await store.readOwn(newPath, fs.lstatSync(newPath));
  assert.equal(result.available, true);
  const next = store.paths(newPath);
  assert.equal(fs.readFileSync(next.notesPath, 'utf8'), '[0:01]\nзаметка\n');
  assert.equal(fs.existsSync(old.notesPath), false);
  assert.equal(JSON.parse(fs.readFileSync(next.manifestPath, 'utf8')).source.path, newPath);
});

test('старая копия на месте: файлы не уводятся', async () => {
  const { root, store } = setup();
  const oldPath = path.join(root, 'a.mp4');
  const stat = makeVideo(oldPath, 1700000000000);
  const old = await writeOld(store, oldPath, stat);
  const copyPath = path.join(root, 'sub', 'a.mp4');
  const copyStat = makeVideo(copyPath, 1700000000000);
  const result = await store.readOwn(copyPath, copyStat);
  assert.equal(result.available, false);
  assert.equal(fs.existsSync(old.notesPath), true);
});

test('существующие файлы нового stem не перезаписываются', async () => {
  const { root, store } = setup();
  const oldPath = path.join(root, 'a.mp4');
  const stat = makeVideo(oldPath, 1700000000000);
  await writeOld(store, oldPath, stat);
  const newPath = path.join(root, 'sub', 'a.mp4');
  fs.renameSync(oldPath, newPath);
  const next = store.paths(newPath);
  fs.writeFileSync(next.notesPath, 'новые');
  await store.relocate(newPath, fs.lstatSync(newPath));
  assert.equal(fs.readFileSync(next.notesPath, 'utf8'), 'новые');
});

test('isMovedSource: тот же размер и mtime, другой путь', () => {
  const manifest = { version: 2, source: { kind: 'file', path: 'D:\\a.mp4', size: 5, mtimeMs: 7 } };
  assert.equal(core.isMovedSource(manifest, { filePath: 'D:\\b\\a.mp4', size: 5, mtimeMs: 7 }), true);
  assert.equal(core.isMovedSource(manifest, { filePath: 'D:\\a.mp4', size: 5, mtimeMs: 7 }), false);
  assert.equal(core.isMovedSource(manifest, { filePath: 'D:\\b\\a.mp4', size: 6, mtimeMs: 7 }), false);
});
