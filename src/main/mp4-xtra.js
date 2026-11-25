"use strict";

// Чтение свойств, которые обработчик свойств Windows хранит в MP4/MOV в боксе moov/udta/Xtra:
// WM/AuthorURL («URL-адрес автора»), WM/Publisher («Издатель», сюда пишется дата публикации)
// и System.Media.DateEncoded (FILETIME). Читаются только заголовки боксов и udta — несколько килобайт,
// файл не блокируется, PowerShell не нужен. Запись остаётся за обработчиком Windows (author-url-property.js).

const { open } = require('node:fs/promises');

const AUTHOR_URL = 'WM/AuthorURL';
const PUBLISHER = 'WM/Publisher';
const DATE_ENCODED = '{2E4B640D-5019-46D8-8881-55414CC5CAAA} 100';
const MAX_UDTA_SIZE = 4 * 1024 * 1024;
const FILETIME_UNIX_OFFSET_MS = 11644473600000;
const VT_BSTR_STRING = 8;
const VT_FILETIME = 64;

class Mp4StructureError extends Error {}

function boxAt(buffer, offset, end) {
  if (offset + 8 > end) return null;
  let size = buffer.readUInt32BE(offset); let header = 8;
  if (size === 1) {
    if (offset + 16 > end) throw new Mp4StructureError('Повреждённый заголовок бокса MP4');
    size = Number(buffer.readBigUInt64BE(offset + 8)); header = 16;
  } else if (size === 0) size = end - offset;
  if (size < header || offset + size > end) throw new Mp4StructureError('Повреждённый размер бокса MP4');
  return { type: buffer.toString('latin1', offset + 4, offset + 8), offset, size, header };
}

// Ищет дочерний бокс по заголовкам на диске, не читая содержимое соседних боксов (mdat — гигабайты).
async function findBoxInFile(handle, start, end, type) {
  const head = Buffer.alloc(16);
  for (let offset = start; offset + 8 <= end;) {
    const { bytesRead } = await handle.read(head, 0, 16, offset);
    if (bytesRead < 8) return null;
    let size = head.readUInt32BE(0); let header = 8;
    if (size === 1) {
      if (bytesRead < 16) throw new Mp4StructureError('Повреждённый заголовок бокса MP4');
      size = Number(head.readBigUInt64BE(8)); header = 16;
    } else if (size === 0) size = end - offset;
    if (size < header || offset + size > end) throw new Mp4StructureError('Повреждённый размер бокса MP4');
    if (head.toString('latin1', 4, 8) === type) return { type, offset, size, header };
    offset += size;
  }
  return null;
}

function findBoxInBuffer(buffer, start, end, type) {
  for (let offset = start; ;) {
    const box = boxAt(buffer, offset, end);
    if (!box) return null;
    if (box.type === type) return box;
    offset += box.size;
  }
}

// Xtra: записи [u32 размер][u32 длина имени][имя][u32 число значений]{[u32 размер][u16 тип][данные]}.
function parseXtra(buffer) {
  const entries = new Map();
  for (let offset = 0; offset + 12 <= buffer.length;) {
    const size = buffer.readUInt32BE(offset);
    if (size < 12 || offset + size > buffer.length) break;
    const nameLength = buffer.readUInt32BE(offset + 4);
    const nameEnd = offset + 8 + nameLength;
    if (nameEnd + 4 > offset + size) break;
    const values = [];
    const count = buffer.readUInt32BE(nameEnd);
    for (let index = 0, valueOffset = nameEnd + 4; index < count && valueOffset + 6 <= offset + size; index += 1) {
      const valueSize = buffer.readUInt32BE(valueOffset);
      if (valueSize < 6 || valueOffset + valueSize > offset + size) break;
      values.push({ type: buffer.readUInt16BE(valueOffset + 4), data: buffer.subarray(valueOffset + 6, valueOffset + valueSize) });
      valueOffset += valueSize;
    }
    entries.set(buffer.toString('latin1', offset + 8, nameEnd), values);
    offset += size;
  }
  return entries;
}

function stringValue(value) {
  return value && value.type === VT_BSTR_STRING ? value.data.toString('utf16le').replace(/\0+$/, '') : '';
}

// FILETIME хранится либо как сериализованный PROPVARIANT (u32 VT_FILETIME + 8 байт), либо голыми 8 байтами.
function fileTimeDate(value) {
  if (!value) return '';
  let ticks = null;
  if (value.data.length >= 12 && value.data.readUInt32LE(0) === VT_FILETIME) ticks = value.data.readBigUInt64LE(4);
  else if (value.data.length === 8) ticks = value.data.readBigUInt64LE(0);
  if (ticks === null || ticks <= 0n) return '';
  const date = new Date(Number(ticks / 10000n) - FILETIME_UNIX_OFFSET_MS);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
}

function propertiesFromXtra(entries) {
  const first = name => (entries.get(name) || [])[0];
  const publisher = stringValue(first(PUBLISHER));
  return {
    url: stringValue(first(AUTHOR_URL)),
    published: /^\d{4}-\d{2}-\d{2}$/.test(publisher) ? publisher : fileTimeDate(first(DATE_ENCODED))
  };
}

// { url, published } — пустые строки, если свойств нет. Бросает Mp4StructureError, если файл не похож на MP4/MOV.
async function readXtraProperties(filePath) {
  const handle = await open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    const moov = await findBoxInFile(handle, 0, size, 'moov');
    if (!moov) throw new Mp4StructureError('В файле нет бокса moov');
    const udta = await findBoxInFile(handle, moov.offset + moov.header, moov.offset + moov.size, 'udta');
    if (!udta) return { url: '', published: '' };
    if (udta.size > MAX_UDTA_SIZE) throw new Mp4StructureError('Слишком большой бокс udta');
    const buffer = Buffer.alloc(udta.size - udta.header);
    await handle.read(buffer, 0, buffer.length, udta.offset + udta.header);
    const xtra = findBoxInBuffer(buffer, 0, buffer.length, 'Xtra');
    if (!xtra) return { url: '', published: '' };
    return propertiesFromXtra(parseXtra(buffer.subarray(xtra.offset + xtra.header, xtra.offset + xtra.size)));
  } finally {
    await handle.close();
  }
}

module.exports = { readXtraProperties, parseXtra, propertiesFromXtra, Mp4StructureError };
