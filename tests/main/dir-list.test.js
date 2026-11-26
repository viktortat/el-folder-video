const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { mkdtemp, mkdir, writeFile, utimes, lstat, rm } = require('node:fs/promises');
const { listDirectory } = require('../../src/main/dir-list');

const isMp4 = name => name.toLowerCase().endsWith('.mp4');

test('список каталога отдаёт подпапки и нужные файлы с теми же размером и датой, что и lstat', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fv-list-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'вложенная'));
  const old = path.join(root, 'старое видео.mp4');
  await writeFile(old, 'x'.repeat(1234));
  await utimes(old, new Date('2020-01-02T03:04:05.678Z'), new Date('2020-01-02T03:04:05.678Z'));
  await writeFile(path.join(root, 'new.mp4'), '');
  await writeFile(path.join(root, 'notes.txt'), 'нет');

  const entries = await listDirectory(root, isMp4);

  assert.deepEqual(entries.map(entry => entry.name).sort(), ['new.mp4', 'вложенная', 'старое видео.mp4'].sort());
  assert.equal(entries.find(entry => entry.name === 'вложенная').isDirectory, true);
  for (const entry of entries.filter(item => item.isFile)) {
    const expected = await lstat(path.join(root, entry.name));
    assert.equal(entry.stat.size, expected.size);
    assert.equal(Math.round(entry.stat.mtimeMs), Math.round(expected.mtimeMs));
  }
});

test('пустой каталог даёт пустой список, отсутствующий — ошибку', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fv-list-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await listDirectory(root, isMp4), []);
  await assert.rejects(listDirectory(path.join(root, 'нет такой'), isMp4), { code: 'ENOENT' });
});
