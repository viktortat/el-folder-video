const Database = require('better-sqlite3');

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map(tag => String(tag).trim()).filter(Boolean))];
}

class VideoMetadataDb {
  constructor(databasePath) {
    this.db = new Database(databasePath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  migrate() {
    const version = this.db.pragma('user_version', { simple: true });
    if (version < 1) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS video_metadata (
          content_hash TEXT PRIMARY KEY,
          file_path TEXT NOT NULL,
          last_seen_at INTEGER NOT NULL,
          youtube_url TEXT NOT NULL DEFAULT '',
          obsidian_url TEXT NOT NULL DEFAULT '',
          description_markdown TEXT NOT NULL DEFAULT '',
          tags_json TEXT NOT NULL DEFAULT '[]',
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_video_metadata_file_path ON video_metadata(file_path);
        PRAGMA user_version = 1;
      `);
    }
  }

  load(contentHash, filePath) {
    const now = Date.now();
    const row = this.db.prepare(`
      SELECT content_hash, file_path, last_seen_at, youtube_url, obsidian_url, description_markdown, tags_json, updated_at
      FROM video_metadata WHERE content_hash = ?
    `).get(contentHash);
    if (!row) return { contentHash, filePath, lastSeenAt: now, youtubeUrl: '', obsidianUrl: '', descriptionMarkdown: '', tags: [], updatedAt: null };
    this.db.prepare('UPDATE video_metadata SET file_path = ?, last_seen_at = ? WHERE content_hash = ?').run(filePath, now, contentHash);
    return {
      contentHash: row.content_hash,
      filePath,
      lastSeenAt: now,
      youtubeUrl: row.youtube_url,
      obsidianUrl: row.obsidian_url,
      descriptionMarkdown: row.description_markdown,
      tags: JSON.parse(row.tags_json),
      updatedAt: row.updated_at
    };
  }

  save(metadata) {
    const now = Date.now();
    const tags = normalizeTags(metadata.tags);
    this.db.prepare(`
      INSERT INTO video_metadata (content_hash, file_path, last_seen_at, youtube_url, obsidian_url, description_markdown, tags_json, updated_at)
      VALUES (@contentHash, @filePath, @lastSeenAt, @youtubeUrl, @obsidianUrl, @descriptionMarkdown, @tagsJson, @updatedAt)
      ON CONFLICT(content_hash) DO UPDATE SET
        file_path = excluded.file_path,
        last_seen_at = excluded.last_seen_at,
        youtube_url = excluded.youtube_url,
        obsidian_url = excluded.obsidian_url,
        description_markdown = excluded.description_markdown,
        tags_json = excluded.tags_json,
        updated_at = excluded.updated_at
    `).run({
      contentHash: metadata.contentHash,
      filePath: metadata.filePath,
      lastSeenAt: now,
      youtubeUrl: metadata.youtubeUrl || '',
      obsidianUrl: metadata.obsidianUrl || '',
      descriptionMarkdown: metadata.descriptionMarkdown || '',
      tagsJson: JSON.stringify(tags),
      updatedAt: now
    });
    return { ...metadata, lastSeenAt: now, updatedAt: now, tags };
  }

  close() { this.db.close(); }
}

module.exports = { VideoMetadataDb, normalizeTags };
