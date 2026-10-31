const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatNoteTime, parseNotes, activeNote, upsertNote, shiftNotes } = require('../../src/shared/notes-core');

test('заметки разбираются по временным меткам и строкам ---', () => {
  const notes = parseNotes('[10:40]\nПервый абзац\nВторая строка\n---\n[1:02:03] Другая заметка\n');
  assert.deepEqual(notes.map(note => [note.start, note.text]), [[640, 'Первый абзац\nВторая строка'], [3723, 'Другая заметка']]);
  assert.equal(formatNoteTime(3723), '1:02:03');
});

test('при пересечении десятисекундных интервалов показывается последняя заметка', () => {
  const notes = parseNotes('[0:10]\nПервая\n---\n[0:15]\nВторая\n');
  assert.equal(activeNote(notes, 14.9).text, 'Первая');
  assert.equal(activeNote(notes, 15).text, 'Вторая');
  assert.equal(activeNote(notes, 25), null);
});

test('правка существующей заметки сохраняет её метку и соседний блок', () => {
  const source = '[0:10]\nПервая\n---\n[0:20]\nВторая\n';
  const result = upsertNote(source, 10, 'Исправленная\nстрока', 0);
  assert.deepEqual(parseNotes(result).map(note => note.text), ['Исправленная\nстрока', 'Вторая']);
  assert.equal(upsertNote(result, 10, '', 0), '[0:20]\nВторая\n');
});

test('после вырезки метки сдвигаются, а заметки внутри вырезанного удаляются', () => {
  const source = '[0:05]\nдо\n---\n[0:15]\nвнутри\n---\n[0:30]\nпосле\n---\nбез метки\n---\n[1:10]\nещё\n';
  const result = shiftNotes(source, [{ start: 10, end: 20 }, { start: 40, end: 50 }]);
  assert.equal(result, '[0:05]\nдо\n---\n[0:20]\nпосле\n---\nбез метки\n---\n[0:50]\nещё\n');
  assert.equal(shiftNotes('[0:15]\nпропадёт\n', [{ start: 10, end: 20 }]), '');
  assert.equal(shiftNotes('[0:20]\nна границе\n', [{ start: 10, end: 20 }]), '[0:10]\nна границе\n');
});
