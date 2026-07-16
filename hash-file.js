const { createReadStream } = require('node:fs');
const { createHash } = require('node:crypto');

function hashFile(filePath, signal) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    const abortError = () => Object.assign(new Error('Hashing cancelled'), { name: 'AbortError' });
    const abort = () => stream.destroy(abortError());
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', error => { signal?.removeEventListener('abort', abort); reject(error); });
    stream.on('end', () => { signal?.removeEventListener('abort', abort); resolve(hash.digest('hex')); });
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

module.exports = { hashFile };
