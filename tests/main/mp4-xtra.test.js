const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readXtraProperties, parseXtra, propertiesFromXtra, Mp4StructureError } = require('../../src/main/mp4-xtra');

function box(type, ...parts) {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8); head.writeUInt32BE(8 + body.length, 0); head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
}
function xtraValue(type, data) {
  const head = Buffer.alloc(6); head.writeUInt32BE(6 + data.length, 0); head.writeUInt16BE(type, 4);
  return Buffer.concat([head, data]);
}
function xtraEntry(name, ...values) {
  const nameBytes = Buffer.from(name, 'latin1');
  const head = Buffer.alloc(8); head.writeUInt32BE(nameBytes.length, 4);
  const count = Buffer.alloc(4); count.writeUInt32BE(values.length, 0);
  const entry = Buffer.concat([head, nameBytes, count, ...values]);
  entry.writeUInt32BE(entry.length, 0);
  return entry;
}
const utf16 = text => Buffer.from(text + '\0', 'utf16le');
function fileTime(isoDate) {
  const data = Buffer.alloc(12); data.writeUInt32LE(64, 0);
  data.writeBigUInt64LE((BigInt(Date.parse(isoDate)) + 11644473600000n) * 10000n, 4);
  return data;
}
// Минимальный MP4 в раскладке, которую оставляет Проводник: ftyp, moov(mvhd, udta(meta, Xtra)), free, mdat.
function mp4(xtraEntries, { moovLast = false } = {}) {
  const udta = xtraEntries ? box('udta', box('meta', Buffer.alloc(12)), box('Xtra', ...xtraEntries)) : Buffer.alloc(0);
  const moov = box('moov', box('mvhd', Buffer.alloc(100)), udta);
  const mdat = box('mdat', Buffer.alloc(4096, 7));
  const ftyp = box('ftyp', Buffer.from('isom\0\0\x02\0isomiso2', 'latin1'));
  return Buffer.concat(moovLast ? [ftyp, mdat, moov] : [ftyp, moov, box('free'), mdat]);
}

const URL = 'https://www.youtube.com/watch?v=odTVgALmGt0';
const DATE_ENCODED = '{2E4B640D-5019-46D8-8881-55414CC5CAAA} 100';

test('Xtra: ссылка и дата из «Издателя» читаются, «Издатель» важнее DateEncoded', () => {
  const entries = parseXtra(Buffer.concat([
    xtraEntry('WM/AuthorURL', xtraValue(8, utf16(URL))),
    xtraEntry(DATE_ENCODED, xtraValue(0x41, fileTime('2020-01-01T12:00:00Z'))),
    xtraEntry('WM/Publisher', xtraValue(8, utf16('2026-11-24')))
  ]));
  assert.deepEqual(propertiesFromXtra(entries), { url: URL, published: '2026-11-24' });
});

test('Xtra: без даты в «Издателе» берётся DateEncoded; «Издатель» с другим текстом не считается датой', () => {
  const entries = parseXtra(Buffer.concat([
    xtraEntry('WM/Publisher', xtraValue(8, utf16('Моя студия'))),
    xtraEntry(DATE_ENCODED, xtraValue(0x41, fileTime('2025-11-15T12:00:00Z')))
  ]));
  assert.deepEqual(propertiesFromXtra(entries), { url: '', published: '2025-11-15' });
});

test('Xtra: обрезанная запись не роняет разбор и не выходит за границы', () => {
  const full = xtraEntry('WM/AuthorURL', xtraValue(8, utf16(URL)));
  assert.equal(parseXtra(full.subarray(0, full.length - 5)).size, 0);
});

test('файл: свойства находятся при moov в начале и в конце, без udta — пусто, не MP4 — ошибка', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fv-xtra-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const entries = [xtraEntry('WM/AuthorURL', xtraValue(8, utf16(URL))), xtraEntry('WM/Publisher', xtraValue(8, utf16('2026-11-24')))];
  const cases = [['start.mp4', mp4(entries)], ['end.mp4', mp4(entries, { moovLast: true })], ['plain.mp4', mp4(null)]];
  for (const [name, data] of cases) await fs.writeFile(path.join(root, name), data);
  assert.deepEqual(await readXtraProperties(path.join(root, 'start.mp4')), { url: URL, published: '2026-11-24' });
  assert.deepEqual(await readXtraProperties(path.join(root, 'end.mp4')), { url: URL, published: '2026-11-24' });
  assert.deepEqual(await readXtraProperties(path.join(root, 'plain.mp4')), { url: '', published: '' });
  await fs.writeFile(path.join(root, 'text.mp4'), 'это не видео, а текст с размером бокса больше файла');
  await assert.rejects(readXtraProperties(path.join(root, 'text.mp4')), Mp4StructureError);
});
