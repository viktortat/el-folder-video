"use strict";
// Транскрибация в отдельном процессе (fork с ELECTRON_RUN_AS_NODE): transcribe.dll через koffi.
// Отдельный процесс нужен, чтобы тяжёлые вызовы не подвешивали main, а сбой драйвера не закрывал приложение.
// Звук идёт потоком из ffmpeg (PATH) кусками по 15 с; слова с временем собираются во фразы.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { wordsToPhrases, round2 } = require('../shared/transcript-store-core');

const send = message => process.send(message);
const SAMPLE_RATE = 16000;
const CHUNK_BYTES = 15 * SAMPLE_RATE * 4;

async function run({ dll, model, media }) {
  const koffi = require('koffi');
  process.env.PATH = `${path.dirname(dll)}${path.delimiter}${process.env.PATH || ''}`; // зависимые библиотеки лежат рядом
  // ggml-vulkan.dll ищет vulkan-1.dll сначала рядом с исполняемым файлом, а там лежит версия Chromium и роняет процесс:
  // подгружаем системный загрузчик заранее — имя модуля совпадёт.
  const system32 = path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'vulkan-1.dll');
  if (process.platform === 'win32' && fs.existsSync(system32)) koffi.load(system32);
  const lib = koffi.load(dll);
  koffi.struct('transcribe_segment', { struct_size: 'uint64', t0_ms: 'int64', t1_ms: 'int64', first_word: 'int', n_words: 'int', first_token: 'int', n_tokens: 'int', text: 'const char *', speaker_id: 'int32' });
  koffi.struct('transcribe_word', { struct_size: 'uint64', t0_ms: 'int64', t1_ms: 'int64', seg_index: 'int', first_token: 'int', n_tokens: 'int', text: 'const char *' });
  koffi.opaque('transcribe_session');
  const initBackends = lib.func('int transcribe_init_backends_default()');
  const open = lib.func('int transcribe_open(const char *model, void *a, void *b, _Out_ transcribe_session **out)');
  const runFn = lib.func('int transcribe_run(transcribe_session *s, float *samples, int n, void *opts)');
  const nSegments = lib.func('int transcribe_n_segments(transcribe_session *s)');
  const segmentInit = lib.func('void transcribe_segment_init(_Inout_ transcribe_segment *seg)');
  const getSegment = lib.func('int transcribe_get_segment(transcribe_session *s, int index, _Inout_ transcribe_segment *seg)');
  const nWords = lib.func('int transcribe_n_words(transcribe_session *s)');
  const wordInit = lib.func('void transcribe_word_init(_Inout_ transcribe_word *w)');
  const getWord = lib.func('int transcribe_get_word(transcribe_session *s, int index, _Inout_ transcribe_word *w)');
  const statusString = lib.func('const char *transcribe_status_string(int code)');
  const free = lib.func('void transcribe_session_free(transcribe_session *s)');

  const init = initBackends();
  if (init) throw new Error(`Не удалось инициализировать backend: ${statusString(init)}`);
  const out = [null];
  const openStatus = open(model, null, null, out);
  if (openStatus) throw new Error(`Не удалось загрузить модель: ${statusString(openStatus)}`);
  const session = out[0];

  let child;
  try {
    child = spawn('ffmpeg', ['-v', 'error', '-i', media, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', 'pipe:1'], { windowsHide: true });
    let stderr = '';
    let spawnError = null;
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-2000); });
    child.on('error', error => { spawnError = error; });
    const closed = new Promise(resolve => child.on('close', resolve));

    // Длительность нужна только для процентов: берём её у ffmpeg без ffprobe.
    const total = await new Promise(resolve => {
      const probe = spawn('ffmpeg', ['-i', media], { windowsHide: true });
      let text = '';
      probe.stderr.on('data', chunk => { text += chunk.toString('utf8'); });
      probe.on('close', () => {
        const match = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
        resolve(match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0);
      });
      probe.on('error', () => resolve(0));
    });

    const words = [];
    const fallback = [];
    let offset = 0;
    const handleChunk = raw => {
      const samples = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length - (raw.length % 4)));
      const status = runFn(session, samples, samples.length, null);
      if (status) throw new Error(`Ошибка распознавания на ${Math.floor(offset)} с: ${statusString(status)}`);
      const chunkWords = [];
      for (let index = 0; index < nWords(session); index++) {
        const word = {};
        wordInit(word);
        if (getWord(session, index, word) === 0) {
          const text = String(word.text ?? '').trim();
          if (text) chunkWords.push({ start: round2(offset + Number(word.t0_ms) / 1000), end: round2(offset + Number(word.t1_ms) / 1000), text });
        }
      }
      words.push(...chunkWords);
      if (!chunkWords.length) {
        for (let index = 0; index < nSegments(session); index++) {
          const segment = {};
          segmentInit(segment);
          if (getSegment(session, index, segment) === 0) {
            const text = String(segment.text ?? '').trim();
            if (text) fallback.push({ start: round2(offset + Number(segment.t0_ms) / 1000), end: round2(offset + Number(segment.t1_ms) / 1000), text });
          }
        }
      }
      offset += samples.length / SAMPLE_RATE;
      send({ progress: { current: offset, total: Math.max(total, offset) } });
    };

    let pending = Buffer.alloc(0);
    for await (const data of child.stdout) {
      pending = Buffer.concat([pending, data]);
      while (pending.length >= CHUNK_BYTES) {
        handleChunk(pending.subarray(0, CHUNK_BYTES));
        pending = pending.subarray(CHUNK_BYTES);
        await new Promise(resolve => setTimeout(resolve, 0)); // иначе сообщения о прогрессе уйдут только после всего цикла
      }
    }
    if (pending.length >= 4) handleChunk(pending);
    if (spawnError) throw new Error(spawnError.code === 'ENOENT' ? 'ffmpeg не найден в PATH. Установите ffmpeg или добавьте его в PATH.' : spawnError.message);
    if ((await closed) !== 0) throw new Error(`ffmpeg не смог извлечь аудио:\n${stderr}`);
    const segments = [...wordsToPhrases(words), ...fallback].sort((a, b) => a.start - b.start);
    return { segments };
  } finally {
    if (child && child.exitCode === null) child.kill();
    free(session);
  }
}

run(JSON.parse(process.argv[2]))
  .then(result => { send({ done: result }); process.exit(0); })
  .catch(error => { send({ error: String(error && error.message || error) }); process.exit(1); });
