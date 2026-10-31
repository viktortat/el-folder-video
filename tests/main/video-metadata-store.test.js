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
