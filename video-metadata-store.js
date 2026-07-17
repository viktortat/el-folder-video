const { mkdir, readFile, rename, writeFile } = require('node:fs/promises');
const path = require('node:path');

function normalizeTags(tags) { return [...new Set((Array.isArray(tags) ? tags : []).map(value => String(value).trim()).filter(Boolean))]; }
function now() { return new Date().toISOString(); }

class VideoMetadataStore {
  constructor(directory) { this.directory = path.resolve(directory); }
  filePath(contentHash) { return path.join(this.directory, `${contentHash.toLowerCase()}.json`); }
  async load(contentHash, fileName) {
    try { return JSON.parse(await readFile(this.filePath(contentHash), 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Не удалось прочитать JSON метаданных: ${error.message}`);
      return { schemaVersion: 1, contentHash, title: path.parse(fileName).name, originalFileName: fileName, youtubeUrl: '', obsidianUrl: '', projectFolder: '', descriptionMarkdown: '', tags: [], createdAt: null, updatedAt: null };
    }
  }
  async save(metadata) {
    await mkdir(this.directory, { recursive: true });
    const current = await this.load(metadata.contentHash, metadata.originalFileName || 'video');
    const saved = {
      schemaVersion: 1, contentHash: metadata.contentHash.toLowerCase(), title: metadata.title || path.parse(metadata.originalFileName || 'video').name,
      originalFileName: metadata.originalFileName || current.originalFileName || '', youtubeUrl: metadata.youtubeUrl || '', obsidianUrl: metadata.obsidianUrl || '',
      projectFolder: metadata.projectFolder || '', descriptionMarkdown: metadata.descriptionMarkdown || '', tags: normalizeTags(metadata.tags),
      createdAt: current.createdAt || now(), updatedAt: now()
    };
    const target = this.filePath(saved.contentHash); const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(saved, null, 2)}\n`, 'utf8'); await rename(temporary, target);
    return saved;
  }
}
module.exports = { VideoMetadataStore, normalizeTags };
