const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RELEASES_REPO, parseVersion, compareVersions, parseRelease, latestRelease } = require('./update-core');

function fixture(version, extra = {}) {
  const tag = `folder-video-v${version}`;
  const name = `folder-video-setup-${version}.exe`;
  return { tag_name: tag, body: ' Изменения ', assets: [{ name, size: 123,
    browser_download_url: `https://github.com/${RELEASES_REPO}/releases/download/${tag}/${name}`,
    digest: `sha256:${'a'.repeat(64)}` }], ...extra };
}

test('версии сравниваются численно, некорректные и prerelease-версии отклоняются', () => {
  assert.equal(compareVersions('1.0.100', '1.0.20'), 1);
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
  assert.equal(compareVersions('1.0.20', '1.0.20'), 0);
  for (const value of ['v1.0.0', '1.0.0-beta', '01.0.0', '1.0', '1.0.0\n', null, '9007199254740992.0.0']) assert.equal(parseVersion(value), null);
});

test('выбирается максимальная версия Folder-video среди релизов разных приложений', () => {
  const list = [fixture('1.0.20'), fixture('1.0.100'), fixture('99.0.0', { tag_name: 'okoshko-v99.0.0' }),
    fixture('10.0.0', { draft: true }), fixture('11.0.0', { prerelease: true }), fixture('1.0.99')];
  const release = latestRelease(list);
  assert.equal(release.version, '1.0.100');
  assert.equal(release.notes, 'Изменения');
  assert.equal(release.sha256, 'a'.repeat(64));
  assert.equal(latestRelease(null), null);
});

test('постоянный latest, испорченные записи и неподходящие установщики пропускаются', () => {
  for (const value of [null, {}, fixture('1.0.0', { tag_name: 'folder-video-latest' }),
    fixture('1.0.0', { assets: {} }), fixture('1.0.0', { assets: [null] }), fixture('1.0.0', { assets: [] })]) assert.equal(parseRelease(value), null);
  for (const change of [{ name: '../outside.exe' }, { name: 'okoshko-setup.exe' },
    { browser_download_url: 'http://github.com/file.exe' }, { browser_download_url: 'https://example.org/setup.exe' },
    { size: 0 }, { size: -1 }, { digest: 'sha256:bad' }]) {
    const value = fixture('1.0.0');
    Object.assign(value.assets[0], change);
    assert.equal(parseRelease(value), null);
  }
});

test('старые релизы без digest поддерживаются, постоянное имя установщика допустимо в версионном теге', () => {
  const value = fixture('1.0.0');
  const asset = value.assets[0];
  asset.name = 'folder-video-setup.exe';
  asset.browser_download_url = `https://github.com/${RELEASES_REPO}/releases/download/${value.tag_name}/${asset.name}`;
  delete asset.digest;
  assert.equal(parseRelease(value).sha256, null);
  assert.equal(parseRelease(value).name, asset.name);
});
