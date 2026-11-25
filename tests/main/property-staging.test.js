const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { PropertyStaging, isStagingFile } = require('../../src/main/property-staging');
const { writeAuthorUrl, readAuthorUrl } = require('../../src/main/author-url-property');

async function tempDir(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fv-staging-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 30 }));
  return root;
}

test('копия пишется рядом, оригинал не меняется до подмены; после подмены копии нет', async t => {
  const root = await tempDir(t);
  const file = path.join(root, 'Видео.mp4');
  await fs.writeFile(file, 'оригинал');
  const staging = new PropertyStaging();
  const { token, result } = await staging.stage(file, async (target, timesFrom) => {
    assert.equal(timesFrom, file);
    assert.equal(path.dirname(target), root);
    assert.ok(isStagingFile(path.basename(target)));
    assert.ok(target.endsWith('.mp4'), 'расширение сохраняется: от него зависит обработчик свойств');
    await fs.writeFile(target, 'со свойствами');
    return { url: 'ссылка' };
  }, { url: 'ссылка' });
  assert.deepEqual(result, { url: 'ссылка' });
  assert.equal(await fs.readFile(file, 'utf8'), 'оригинал');
  const committed = await staging.commit(token);
  assert.equal(committed.filePath, file);
  assert.deepEqual(committed.meta, { url: 'ссылка' });
  assert.equal(await fs.readFile(file, 'utf8'), 'со свойствами');
  assert.deepEqual(await fs.readdir(root), ['Видео.mp4']);
  await assert.rejects(staging.commit(token), /не найдена/);
});

test('ошибка записи и изменённый оригинал не оставляют копию и не трогают файл', async t => {
  const root = await tempDir(t);
  const file = path.join(root, 'clip.mp4');
  await fs.writeFile(file, 'оригинал');
  const staging = new PropertyStaging();
  await assert.rejects(staging.stage(file, async () => { throw new Error('сбой записи'); }), /сбой записи/);
  assert.deepEqual(await fs.readdir(root), ['clip.mp4']);

  const { token } = await staging.stage(file, async target => { await fs.writeFile(target, 'копия'); return {}; });
  await fs.writeFile(file, 'вырезали фрагмент');
  await assert.rejects(staging.commit(token), /изменилось/);
  assert.equal(await fs.readFile(file, 'utf8'), 'вырезали фрагмент');
  assert.deepEqual(await fs.readdir(root), ['clip.mp4']);

  const second = await staging.stage(file, async target => { await fs.writeFile(target, 'копия'); return {}; });
  await staging.discardAll();
  assert.deepEqual(await fs.readdir(root), ['clip.mp4']);
  await assert.rejects(staging.commit(second.token), /не найдена/);
});

test('Windows: свойства пишутся в копию, после подмены видны, даты оригинала сохранены', { skip: process.platform !== 'win32' }, async t => {
  const root = await tempDir(t);
  const file = path.join(root, 'Урок (RU)_2x.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=32x32:r=1', '-t', '1', '-c:v', 'libx264', file], { windowsHide: true, timeout: 15000 });
  const before = await fs.stat(file);
  const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const staging = new PropertyStaging();
  const { token, result } = await staging.stage(file, (target, timesFrom) => writeAuthorUrl(target, url, '2025-11-15', { timesFrom }));
  assert.equal(result.datesIntact, true);
  assert.equal((await readAuthorUrl(file)).url, '', 'до подмены оригинал не тронут');
  await staging.commit(token);
  assert.deepEqual(await readAuthorUrl(file), { supported: true, url, published: '2025-11-15' });
  const after = await fs.stat(file);
  assert.equal(after.birthtimeMs, before.birthtimeMs);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.deepEqual(await fs.readdir(root), [path.basename(file)]);
});
