'use strict';

// Без Electron и Node.js: разбор общего репозитория релизов нескольких приложений.
const RELEASES_REPO = 'viktortat/utils-releases';
const TAG_PREFIX = 'folder-video-v';
const RELEASES_API = `https://api.github.com/repos/${RELEASES_REPO}/releases`;

function parseVersion(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return null;
  const parts = value.split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) throw new Error('Некорректная версия приложения');
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
  }
  return 0;
}

function parseRelease(value) {
  if (!value || value.draft || value.prerelease || typeof value.tag_name !== 'string' || !value.tag_name.startsWith(TAG_PREFIX)) return null;
  const version = value.tag_name.slice(TAG_PREFIX.length);
  if (!parseVersion(version) || !Array.isArray(value.assets)) return null;
  const names = [`folder-video-setup-${version}.exe`, 'folder-video-setup.exe'];
  for (const asset of value.assets) {
    if (!asset || !names.includes(asset.name) || !Number.isSafeInteger(asset.size) || asset.size <= 0) continue;
    // Установщик должен принадлежать именно этому тегу нашего репозитория.
    const expected = `https://github.com/${RELEASES_REPO}/releases/download/${value.tag_name}/${asset.name}`;
    if (asset.browser_download_url !== expected) continue;
    const digest = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest || '');
    if (asset.digest && !digest) continue;
    return { version, name: asset.name, url: expected, size: asset.size,
      sha256: digest ? digest[1].toLowerCase() : null,
      notes: typeof value.body === 'string' ? value.body.trim() : '' };
  }
  return null;
}

function latestRelease(list) {
  let latest = null;
  if (!Array.isArray(list)) return latest;
  for (const value of list) {
    const release = parseRelease(value);
    if (release && (!latest || compareVersions(release.version, latest.version) > 0)) latest = release;
  }
  return latest;
}

module.exports = { RELEASES_REPO, TAG_PREFIX, RELEASES_API, parseVersion, compareVersions, parseRelease, latestRelease };
