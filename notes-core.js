"use strict";

function noteSeconds(label) {
  const parts = label.split(':').map(Number);
  if (parts.length === 2 && parts[1] < 60) return parts[0] * 60 + parts[1];
  if (parts.length === 3 && parts[1] < 60 && parts[2] < 60) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function formatNoteTime(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}` : `${minutes}:${String(rest).padStart(2, '0')}`;
}

function noteBlocks(source) {
  return String(source || '').replace(/\r\n/g, '\n').split(/^---[ \t]*$/m).map(block => block.trim()).filter(Boolean);
}

function parseNotes(source) {
  return noteBlocks(source).map((block, index) => {
    const [header, ...lines] = block.split('\n');
    const match = /^\[(\d+(?::\d{1,2}){1,2})\](?:[ \t]*(.*))?$/.exec(header.trim());
    if (!match) return null;
    const start = noteSeconds(match[1]);
    if (start === null) return null;
    const text = [match[2] || '', ...lines].join('\n').trim();
    return text ? { start, text, blockIndex: index } : null;
  }).filter(Boolean);
}

function activeNote(notes, seconds) {
  return notes.filter(note => note.start <= seconds && seconds < note.start + 10)
    .reduce((latest, note) => !latest || note.start >= latest.start ? note : latest, null);
}

function upsertNote(source, start, text, blockIndex = null) {
  const blocks = noteBlocks(source);
  const value = String(text || '').trim();
  const replacement = `[${formatNoteTime(start)}]\n${value}`;
  if (Number.isInteger(blockIndex) && blockIndex >= 0 && blockIndex < blocks.length) {
    if (value) blocks[blockIndex] = replacement;
    else blocks.splice(blockIndex, 1);
  } else if (value) blocks.push(replacement);
  return blocks.length ? `${blocks.join('\n---\n')}\n` : '';
}

const notesCore = { formatNoteTime, parseNotes, activeNote, upsertNote };
if (typeof module !== 'undefined' && module.exports) module.exports = notesCore;
else globalThis.NotesCore = notesCore;
