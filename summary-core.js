"use strict";

function srtSegments(srt) {
  return srt.replace(/^\uFEFF/, '').replace(/\r/g, '').trim().split(/\n{2,}/).map(block => {
    const lines = block.split('\n');
    const timeLine = lines.findIndex(line => line.includes('-->'));
    if (timeLine < 0) return null;
    const match = lines[timeLine].match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
    if (!match) return null;
    const seconds = offset => Number(match[offset]) * 3600 + Number(match[offset + 1]) * 60 + Number(match[offset + 2]) + Number(match[offset + 3]) / 1000;
    const text = lines.slice(timeLine + 1).join(' ').trim();
    return text ? { start: seconds(1), end: seconds(5), text } : null;
  }).filter(Boolean);
}

function transcriptBatches(segments) {
  const batches = [];
  let current = [];
  let length = 0;
  for (const [index, segment] of segments.entries()) {
    const line = `[${index + 1}] ${Math.floor(segment.start)}с ${segment.text}`;
    if (current.length && length + line.length > 80000) { batches.push(current); current = []; length = 0; }
    current.push(line); length += line.length + 1;
  }
  if (current.length) batches.push(current);
  return batches;
}

function normalizeSummary(raw, segments, allowed) {
  const overview = raw.overview.trim().split(/\n\s*\n/).slice(0, 3).join('\n\n').slice(0, 12000);
  if (!overview) throw new Error('DeepSeek вернул пустую сводку.');
  const seen = new Set();
  const topics = raw.topics.filter(item => item && typeof item === 'object').map(item => {
    const index = Number(item.segmentIndex);
    if (!Number.isInteger(index) || !allowed.has(index) || !segments[index - 1] || seen.has(index)) return null;
    const title = typeof item.title === 'string' ? item.title.trim().slice(0, 180) : '';
    if (!title) return null;
    seen.add(index);
    return { title, description: typeof item.description === 'string' ? item.description.trim().slice(0, 500) : '', start: segments[index - 1].start };
  }).filter(Boolean).sort((a, b) => a.start - b.start).slice(0, 10);
  return { overview, topics };
}

module.exports = { srtSegments, transcriptBatches, normalizeSummary };
