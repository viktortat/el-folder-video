const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { VideoMetadataDb } = require('./video-metadata-db');

test('metadata is restored by hash after file path changes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'folder-video-db-'));
  const databasePath = path.join(directory, 'metadata.sqlite');
  const db = new VideoMetadataDb(databasePath);
  const hash = 'a'.repeat(64);
  db.save({ contentHash: hash, filePath: 'D:\\old\\video.mp4', youtubeUrl: 'https://youtu.be/example', obsidianUrl: 'obsidian://open/?vault=ai-study&file=Main', descriptionMarkdown: '# Notes', tags: ['sqlite', 'video', 'sqlite'] });
  const loaded = db.load(hash, 'K:\\new\\video.mp4');
  assert.equal(loaded.filePath, 'K:\\new\\video.mp4');
  assert.deepEqual(loaded.tags, ['sqlite', 'video']);
  assert.equal(loaded.descriptionMarkdown, '# Notes');
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
