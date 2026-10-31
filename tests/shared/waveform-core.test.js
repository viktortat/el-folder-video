const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PeakCollector, peakGain, waveformColumns } = require('../../src/shared/waveform-core');

function pcm(samples) {
  const buffer = Buffer.alloc(samples.length * 2);
  samples.forEach((value, index) => buffer.writeInt16LE(value, index * 2));
  return buffer;
}

test('пики собираются по ячейкам, неполная последняя ячейка сохраняется', () => {
  const collector = new PeakCollector(4);
  collector.push(pcm([0, 25800, -25800, 100, 0, 0, 0, 0, 258, -258]));
  assert.deepEqual([...collector.result()], [-100, 100, 0, 0, -1, 1]);
});

test('сэмпл, разрезанный между кусками потока, не теряется', () => {
  const whole = pcm([258, -258, 25800, 0]);
  const collector = new PeakCollector(4);
  collector.push(whole.subarray(0, 3));
  collector.push(whole.subarray(3));
  assert.deepEqual([...collector.result()], [-1, 100]);
});

test('столбцы берут минимум и максимум по своим ячейкам, за пределами звука — нули', () => {
  const peaks = Int8Array.from([-10, 10, -50, 20, -5, 80, 0, 0]);
  const { min, max } = waveformColumns(peaks, 4, 0, 0.5, 4);
  assert.deepEqual([...min], [-50, -5, 0, 0]);
  assert.deepEqual([...max], [20, 80, 0, 0]);
  assert.equal(peakGain(peaks), 127 / 80);
  assert.equal(peakGain(new Int8Array(4)), 1);
});

test('большой поток растит буфер', () => {
  const collector = new PeakCollector(2);
  collector.push(pcm(new Array(200000).fill(1000)));
  assert.equal(collector.result().length, 200000);
});
