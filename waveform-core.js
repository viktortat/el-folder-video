"use strict";

// Пики звука для полосы вырезки. Без Node.js-API: main собирает пики, renderer рисует столбцы.

const SAMPLE_RATE = 8000;
const BIN_FRAMES = 20;
const BINS_PER_SECOND = SAMPLE_RATE / BIN_FRAMES;

// Собирает пики (минимум и максимум на ячейку, −127..127) из потока 16-битных моно PCM (little-endian).
class PeakCollector {
  constructor(binFrames = BIN_FRAMES) {
    this.binFrames = binFrames;
    this.data = new Int8Array(1 << 16);
    this.length = 0;
    this.inBin = 0;
    this.min = 32767;
    this.max = -32768;
    this.leftover = null;
  }

  grow(extra) {
    if (this.length + extra <= this.data.length) return;
    const next = new Int8Array(Math.max(this.data.length * 2, this.length + extra));
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  }

  flush() {
    this.grow(2);
    this.data[this.length++] = Math.round(this.min / 258);
    this.data[this.length++] = Math.round(this.max / 258);
    this.inBin = 0;
    this.min = 32767;
    this.max = -32768;
  }

  push(chunk) {
    let bytes = chunk;
    if (this.leftover !== null) {
      bytes = new Uint8Array(chunk.length + 1);
      bytes[0] = this.leftover;
      bytes.set(chunk, 1);
      this.leftover = null;
    }
    const whole = bytes.length - (bytes.length % 2);
    if (bytes.length !== whole) this.leftover = bytes[whole];
    const view = new DataView(bytes.buffer, bytes.byteOffset, whole);
    for (let offset = 0; offset < whole; offset += 2) {
      const value = view.getInt16(offset, true);
      if (value < this.min) this.min = value;
      if (value > this.max) this.max = value;
      if (++this.inBin === this.binFrames) this.flush();
    }
  }

  // Пики всего звука: пары [min, max] подряд; неполная последняя ячейка тоже сохраняется.
  result() {
    if (this.inBin > 0) this.flush();
    return this.data.slice(0, this.length);
  }
}

function peakGain(peaks) {
  let max = 0;
  for (let index = 0; index < peaks.length; index++) max = Math.max(max, Math.abs(peaks[index]));
  return max > 0 ? 127 / max : 1;
}

// Для каждого из width столбцов: минимум и максимум пиков на отрезке [start + x*spp, start + (x+1)*spp).
function waveformColumns(peaks, binsPerSecond, start, secondsPerPixel, width) {
  const count = Math.floor(peaks.length / 2);
  const min = new Int8Array(width);
  const max = new Int8Array(width);
  for (let x = 0; x < width; x++) {
    const from = Math.floor((start + x * secondsPerPixel) * binsPerSecond);
    if (from >= count || from < 0) continue;
    const to = Math.min(count, Math.max(from + 1, Math.ceil((start + (x + 1) * secondsPerPixel) * binsPerSecond)));
    let low = 127;
    let high = -127;
    for (let bin = from; bin < to; bin++) {
      if (peaks[bin * 2] < low) low = peaks[bin * 2];
      if (peaks[bin * 2 + 1] > high) high = peaks[bin * 2 + 1];
    }
    min[x] = low;
    max[x] = high;
  }
  return { min, max };
}

const waveformCore = { SAMPLE_RATE, BIN_FRAMES, BINS_PER_SECOND, PeakCollector, peakGain, waveformColumns };
if (typeof module !== 'undefined' && module.exports) module.exports = waveformCore;
else globalThis.WaveformCore = waveformCore;
