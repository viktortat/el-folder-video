const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, readdir, rm, stat, utimes, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { CutUndoStore, UNDO_DIRECTORY } = require('./cut-undo');

async function workspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fv-undo-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const video = path.join(root, 'видео.mp4');
  await writeFile(video, 'ORIGINAL-CONTENT');
  const past = new Date('2024-01-02T03:04:05Z');
  await utimes(video, past, past);
  const temp = path.join(root, 'видео.mp4.fv-cut.tmp');
  await writeFile(temp, 'CUT');
  const store = new CutUndoStore(path.join(root, 'state', 'cut-backups.json'));
  return { root, video, temp, store, past };
}

test('вырезка подменяет файл, оригинал уходит в .fv-undo, дата сохраняется', async t => {
  const { root, video, temp, store, past } = await workspace(t);
  const entry = await store.commit({ sourcePath: video, tempPath: temp, ranges: [{ start: 1, end: 2 }] });
  assert.equal(await readFile(video, 'utf8'), 'CUT');
  assert.equal(await readFile(entry.backupPath, 'utf8'), 'ORIGINAL-CONTENT');
  assert.equal(path.dirname(entry.backupPath), path.join(root, UNDO_DIRECTORY));
  assert.equal(Math.round((await stat(video)).mtimeMs / 1000), Math.round(past.getTime() / 1000));
  assert.equal((await store.list()).length, 1);
});

test('отмена возвращает оригинал и убирает пустую служебную папку', async t => {
  const { root, video, temp, store } = await workspace(t);
  const entry = await store.commit({ sourcePath: video, tempPath: temp });
  await store.undo(entry.id);
  assert.equal(await readFile(video, 'utf8'), 'ORIGINAL-CONTENT');
  assert.deepEqual((await readdir(root)).filter(name => name === UNDO_DIRECTORY || name.endsWith('.undone')), []);
  assert.deepEqual(await store.list(), []);
});

test('отмена отказывает, если результат вырезки изменили снаружи', async t => {
  const { video, temp, store } = await workspace(t);
  const entry = await store.commit({ sourcePath: video, tempPath: temp });
  await writeFile(video, 'EDITED-BY-USER-LONGER');
  await assert.rejects(store.undo(entry.id), /изменён после вырезки/);
  assert.equal(await readFile(video, 'utf8'), 'EDITED-BY-USER-LONGER');
  assert.equal((await store.list()).length, 1);
});

test('заметки сохраняются в бэкап и возвращаются при отмене', async t => {
  const { root, video, temp, store } = await workspace(t);
  const notes = path.join(root, 'notes', 'видео.notes.md');
  await mkdir(path.dirname(notes));
  await writeFile(notes, '[0:10]\nстарая\n');
  const entry = await store.commit({ sourcePath: video, tempPath: temp, sidecars: [notes] });
  await writeFile(notes, '[0:05]\nновая\n');
  await store.undo(entry.id);
  assert.equal(await readFile(notes, 'utf8'), '[0:10]\nстарая\n');
});

test('заметки, которых не было, удаляются при отмене', async t => {
  const { root, video, temp, store } = await workspace(t);
  const notes = path.join(root, 'нет.notes.md');
  const entry = await store.commit({ sourcePath: video, tempPath: temp, sidecars: [notes] });
  await writeFile(notes, 'появилась после вырезки');
  await store.undo(entry.id);
  await assert.rejects(stat(notes), { code: 'ENOENT' });
});

test('при сбое подмены оригинал остаётся на месте', async t => {
  const { video, temp, store } = await workspace(t);
  await rm(temp);
  await assert.rejects(store.commit({ sourcePath: video, tempPath: temp }));
  assert.equal(await readFile(video, 'utf8'), 'ORIGINAL-CONTENT');
  assert.deepEqual(await store.list(), []);
});

test('старые бэкапы удаляются, свежие остаются', async t => {
  const { root, video, temp, store } = await workspace(t);
  let clock = Date.parse('2026-01-01T00:00:00Z');
  const aged = new CutUndoStore(store.registryPath, { now: () => clock });
  const first = await aged.commit({ sourcePath: video, tempPath: temp });
  clock += 8 * 24 * 3600 * 1000;
  await writeFile(temp, 'CUT-2');
  const second = await aged.commit({ sourcePath: video, tempPath: temp });
  const removed = await aged.prune(7 * 24 * 3600 * 1000);
  assert.equal(removed, 1);
  const names = await readdir(path.join(root, UNDO_DIRECTORY));
  assert.deepEqual(names, [path.basename(second.backupPath)]);
  assert.equal((await aged.list()).map(item => item.id)[0], second.id);
  assert.ok(first.id !== second.id);
});

test('очистка удаляет все бэкапы', async t => {
  const { root, video, temp, store } = await workspace(t);
  await store.commit({ sourcePath: video, tempPath: temp });
  assert.equal(await store.clear(), 1);
  assert.ok(!(await readdir(root)).includes(UNDO_DIRECTORY));
  assert.deepEqual(await store.list(), []);
});
