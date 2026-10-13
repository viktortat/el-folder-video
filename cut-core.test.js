const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('./cut-core');

test('диапазоны сортируются, обрезаются по длительности и сливаются', () => {
  const result = core.normalizeRanges([{ start: 30, end: 40 }, { start: 5, end: 12 }, { start: 10, end: 20 }, { start: 95, end: 130 }, { start: 3, end: 3.01 }], 100);
  assert.deepEqual(result, [{ start: 5, end: 20 }, { start: 30, end: 40 }, { start: 95, end: 100 }]);
});

test('соприкасающиеся диапазоны сливаются, мусорные значения отбрасываются', () => {
  assert.deepEqual(core.normalizeRanges([{ start: 1, end: 2 }, { start: 2, end: 3 }, { start: NaN, end: 4 }, null, { start: 8, end: 7 }], 10), [{ start: 1, end: 3 }]);
});

test('оставшиеся отрезки лежат между вырезанными', () => {
  assert.deepEqual(core.keepSegments([{ start: 10, end: 20 }, { start: 50, end: 60 }], 60), [{ start: 0, end: 10 }, { start: 20, end: 50 }]);
  assert.deepEqual(core.keepSegments([{ start: 0, end: 5 }], 60), [{ start: 5, end: 60 }]);
});

test('проверка вырезки сообщает о пустом выборе и слишком малом остатке', () => {
  assert.match(core.validateCut([], 60), /Не выбрано/);
  assert.match(core.validateCut([{ start: 0, end: 59.5 }], 60), /1 секунда/);
  assert.match(core.validateCut([{ start: 0, end: 10 }], 0), /длительность/);
  assert.equal(core.validateCut([{ start: 10, end: 20 }], 60), null);
});

test('конец вырезки привязывается к ключевому кадру не позже заданного', () => {
  const keyframes = [0, 2, 4, 6, 8, 10, 12];
  const { ranges, skipped } = core.snapRangesToKeyframes([{ start: 3, end: 9.5 }], keyframes, 14);
  assert.deepEqual(ranges, [{ start: 3, end: 8 }]);
  assert.deepEqual(skipped, []);
});

test('диапазон без ключевого кадра внутри пропускается, а хвост ключевых кадров не нужен', () => {
  const keyframes = [0, 10, 20];
  const short = core.snapRangesToKeyframes([{ start: 12, end: 15 }], keyframes, 30);
  assert.deepEqual(short.ranges, []);
  assert.deepEqual(short.skipped, [{ start: 12, end: 15 }]);
  const tail = core.snapRangesToKeyframes([{ start: 12, end: 30 }], keyframes, 30);
  assert.deepEqual(tail.ranges, [{ start: 12, end: 30 }]);
});

test('время переносится на новое видео, а внутри вырезанного даёт null', () => {
  const ranges = [{ start: 10, end: 20 }, { start: 50, end: 60 }];
  assert.equal(core.remapTime(ranges, 5), 5);
  assert.equal(core.remapTime(ranges, 10), null);
  assert.equal(core.remapTime(ranges, 20), 10);
  assert.equal(core.remapTime(ranges, 55), null);
  assert.equal(core.remapTime(ranges, 70), 50);
});

test('список concat экранирует кавычки и заменяет обратные слэши', () => {
  const list = core.buildConcatList("C:\\Видео\\it's.mp4", [{ start: 0, end: 10 }, { start: 20, end: 60.1234 }]);
  assert.equal(list, "file 'C:/Видео/it'\\''s.mp4'\ninpoint 0.000\noutpoint 10.000\nfile 'C:/Видео/it'\\''s.mp4'\ninpoint 20.000\noutpoint 60.123\n");
});

test('копирование берёт все дорожки, контейнер остаётся прежним', () => {
  const args = core.buildCopyArguments('list.txt', 'out.tmp', '.mp4');
  assert.deepEqual(args.slice(args.indexOf('-f')), ['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-map', '0:v?', '-map', '0:a?', '-map', '0:s?', '-map_metadata', '0', '-map_chapters', '-1', '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', 'out.tmp']);
  assert.ok(!core.buildCopyArguments('l', 'o', '.mkv').includes('-movflags'));
});

test('точный режим отбирает кадры по времени и не меняет разрешение', () => {
  const args = core.buildReencodeArguments('in.mp4', 'out.tmp', [{ start: 5.5, end: 12.25 }, { start: 30, end: 31 }], '.mp4');
  const video = args[args.indexOf('-filter:v') + 1];
  assert.equal(video, "select='not(gte(t,5.5)*lt(t,12.25)+gte(t,30)*lt(t,31))',setpts='PTS-(gte(T,12.25)*6.75+gte(T,31)*1)/TB'");
  assert.ok(args[args.indexOf('-filter:a') + 1].startsWith("aselect='not("));
  assert.ok(!args.some(value => /scale|-r$|-s$/.test(value)));
  assert.deepEqual(args.slice(args.indexOf('-c:v'), args.indexOf('-c:v') + 2), ['-c:v', 'libx264']);
  assert.equal(args.at(-1), 'out.tmp');
});

test('кодеки перекодирования зависят от расширения', () => {
  assert.deepEqual(core.reencodeCodecArguments('.WEBM'), ['-c:v', 'libvpx-vp9', '-c:a', 'libopus']);
  assert.deepEqual(core.reencodeCodecArguments('.mkv'), ['-c:v', 'libx264', '-c:a', 'aac']);
});

test('время для подписи показывается с десятыми долями', () => {
  assert.equal(core.formatClock(12.46), '00:12.4');
  assert.equal(core.formatClock(3723.5), '1:02:03.5');
});
