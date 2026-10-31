const test = require('node:test');
const assert = require('node:assert/strict');
const { snapshot, parse } = require('../../src/renderer/lib/session-core');

test('сессия сохраняет порядок, активную вкладку и параметры плеера', () => {
  const state = { folderPath: 'D:\\Видео', recursive: true, activeTab: 'two', tabs: [
    { id: 'folder', type: 'folder' },
    { id: 'one', type: 'player', video: { path: 'D:\\Видео\\1.mp4' }, currentTime: 12.5, panelMode: 'notes' },
    { id: 'settings', type: 'settings', draft: { ai: { apiKey: 'secret' } }, dirty: true },
    { id: 'two', type: 'player', video: { path: 'D:\\Видео\\2.mkv' }, currentTime: 94, playbackRate: 1.5, columns: 4, seconds: 15, scroll: 'off', panelWidth: 520, collapsed: true, metadataCollapsed: false }
  ] };
  const saved = snapshot(state);
  assert.deepEqual(parse(JSON.stringify(saved)), saved);
  assert.deepEqual(saved.tabs.map(tab => tab.id), ['folder', 'one', 'settings', 'two']);
  assert.equal(saved.activeTab, 'two');
  assert.equal(saved.folderPath, state.folderPath);
  assert.equal(saved.recursive, true);
  assert.deepEqual(saved.tabs[3], { id: 'two', type: 'player', path: 'D:\\Видео\\2.mkv', currentTime: 94, playbackRate: 1.5, columns: 4, seconds: 15, scroll: 'off', panelWidth: 520, collapsed: true, metadataCollapsed: false });
  assert.equal(saved.tabs[1].panelMode, 'notes');
  assert.ok(!JSON.stringify(saved).includes('secret'));
  assert.ok(!('draft' in saved.tabs[2]));
});

test('закрытые вкладки и выбранная главная страница остаются закрытыми', () => {
  assert.deepEqual(parse(JSON.stringify(snapshot({ tabs: [], activeTab: null }))).tabs, []);
  assert.equal(parse(JSON.stringify(snapshot({ tabs: [{ id: 'folder', type: 'folder' }], activeTab: null }))).activeTab, null);
});

test('отсутствующая или повреждённая сессия не мешает запуску', () => {
  for (const raw of [null, '', '{', 'null', '[]', '{"version":2,"tabs":[]}', '{"version":1,"tabs":{}}']) assert.equal(parse(raw), null);
});

test('повторяющиеся и некорректные вкладки отбрасываются, параметры проверяются', () => {
  const saved = parse(JSON.stringify({ version: 1, activeTab: 'missing', tabs: [
    null, { type: 'unknown' }, { type: 'player', id: 'folder', path: 'a.mp4' },
    { type: 'folder' }, { type: 'folder' },
    { type: 'player', id: 'one', path: 'a.mp4', currentTime: -5, playbackRate: 200, panelWidth: 9000, panelMode: 'invalid', columns: -1 },
    { type: 'player', id: 'two', path: 'a.mp4' }, { type: 'player', id: 'one', path: 'b.mp4' },
    { type: 'player', id: 'empty' }
  ] }));
  assert.deepEqual(saved.tabs.map(tab => tab.id), ['folder', 'one']);
  assert.equal(saved.activeTab, 'folder');
  assert.equal(saved.tabs[1].currentTime, 0);
  assert.equal(saved.tabs[1].playbackRate, 1);
  assert.equal(saved.tabs[1].panelWidth, 720);
  assert.ok(!('panelMode' in saved.tabs[1]));
  assert.ok(!('columns' in saved.tabs[1]));
});
