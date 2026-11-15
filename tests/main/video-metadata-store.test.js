const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { VideoMetadataStore } = require('../../src/main/video-metadata-store');

async function store(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fv-meta-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new VideoMetadataStore(directory);
}

test('метаданные переносятся на новый хэш, исходная запись остаётся', async t => {
  const metadata = await store(t);
  await metadata.save({ contentHash: 'AAA', originalFileName: 'a.mp4', title: 'Название', tags: ['x', 'y'], descriptionMarkdown: 'описание' });
  const copied = await metadata.copy('aaa', 'bbb', 'a.mp4');
  assert.equal(copied.contentHash, 'bbb');
  assert.deepEqual(copied.tags, ['x', 'y']);
  assert.equal((await metadata.load('aaa', 'a.mp4')).title, 'Название');
  assert.equal((await metadata.load('bbb', 'a.mp4')).descriptionMarkdown, 'описание');
});

test('перенос не затирает уже существующую запись нового хэша и пропускает пустой источник', async t => {
  const metadata = await store(t);
  await metadata.save({ contentHash: 'ccc', originalFileName: 'c.mp4', title: 'Старое', tags: [] });
  await metadata.save({ contentHash: 'ddd', originalFileName: 'c.mp4', title: 'Новое', tags: [] });
  assert.equal((await metadata.copy('ccc', 'ddd', 'c.mp4')).title, 'Новое');
  assert.equal(await metadata.copy('нет', 'eee', 'c.mp4'), null);
});

test('дата публикации не затирается формой и не создаёт запись без просьбы', async t => {
  const metadata = await store(t);
  assert.equal(await metadata.setPublishedAt('f00', 'v.mp4', '20251115'), null);
  assert.equal((await metadata.load('f00', 'v.mp4')).createdAt, null);
  const created = await metadata.setPublishedAt('f00', 'v.mp4', '2025-11-15', { create: true });
  assert.equal(created.publishedAt, '2025-11-15');
  const saved = await metadata.save({ contentHash: 'f00', originalFileName: 'v.mp4', title: 'Новое имя', tags: [] });
  assert.equal(saved.publishedAt, '2025-11-15');
  const updated = await metadata.setPublishedAt('f00', 'v.mp4', '2024-02-29');
  assert.equal(updated.publishedAt, '2024-02-29');
  assert.equal((await metadata.copy('f00', 'f01', 'v.mp4')).publishedAt, '2024-02-29');
  assert.equal(await metadata.setPublishedAt('f00', 'v.mp4', 'мусор'), null);
});
