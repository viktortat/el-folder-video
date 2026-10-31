const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtemp, readdir, rm, stat } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { runFfmpeg, probeDuration, listKeyframes, planCut, executeCut } = require('../../src/main/cut-ffmpeg');

const hasFfmpeg = ['ffmpeg', 'ffprobe'].every(command => spawnSync(command, ['-version'], { windowsHide: true }).status === 0);
const options = { skip: hasFfmpeg ? false : 'ffmpeg/ffprobe не найдены в PATH' };

// Видео 60 с, ключевой кадр каждые 2 с, звук и 320x240.
async function sampleVideo(t, extension = '.mp4') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fv-cut-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const video = path.join(root, `тест видео${extension}`);
  const run = runFfmpeg(['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=60:size=320x240:rate=30', '-f', 'lavfi', '-i', 'sine=duration=60',
    '-c:v', 'libx264', '-g', '60', '-bf', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
  await run.promise;
  return { root, video };
}

async function streamInfo(file) {
  const result = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'csv=p=0', file], { encoding: 'utf8', windowsHide: true });
  return result.stdout.trim().split(/\r?\n/);
}

test('ключевые кадры и длительность читаются через ffprobe', options, async t => {
  const { video } = await sampleVideo(t);
  const keyframes = await listKeyframes(video);
  assert.equal(keyframes[0], 0);
  assert.equal(keyframes[1], 2);
  assert.ok(Math.abs(await probeDuration(video) - 60) < 0.1);
});

test('копирование вырезает фрагмент по ключевым кадрам без перекодирования', options, async t => {
  const { root, video } = await sampleVideo(t);
  const plan = await planCut({ sourcePath: video, ranges: [{ start: 9, end: 21.5 }], duration: 60, precise: false });
  assert.deepEqual(plan.ranges, [{ start: 9, end: 22 }]);
  const output = path.join(root, 'тест видео.mp4.fv-cut.tmp');
  const progress = [];
  const result = await executeCut({ sourcePath: video, outputPath: output, plan, onProgress: value => progress.push(value) }).promise;
  assert.ok(Math.abs(result.duration - 47) < 0.3, `длительность ${result.duration}`);
  assert.deepEqual(await streamInfo(output), ['video,320,240', 'audio']);
  assert.ok((await stat(output)).size > 0);
  assert.deepEqual((await readdir(root)).filter(name => name.endsWith('.txt')), []);
});

test('несколько диапазонов склеиваются за один проход', options, async t => {
  const { root, video } = await sampleVideo(t);
  const plan = await planCut({ sourcePath: video, ranges: [{ start: 0, end: 10 }, { start: 30, end: 40 }], duration: 60, precise: false });
  const output = path.join(root, 'out.tmp');
  const result = await executeCut({ sourcePath: video, outputPath: output, plan }).promise;
  assert.ok(Math.abs(result.duration - 40) < 0.3, `длительность ${result.duration}`);
});

test('точный режим перекодирует и режет по заданным секундам', options, async t => {
  const { root, video } = await sampleVideo(t);
  const plan = await planCut({ sourcePath: video, ranges: [{ start: 5.5, end: 12.25 }, { start: 30, end: 31 }], duration: 60, precise: true });
  assert.deepEqual(plan.ranges, [{ start: 5.5, end: 12.25 }, { start: 30, end: 31 }]);
  const output = path.join(root, 'out.tmp');
  const result = await executeCut({ sourcePath: video, outputPath: output, plan }).promise;
  assert.ok(Math.abs(result.duration - 52.25) < 0.2, `длительность ${result.duration}`);
  assert.deepEqual(await streamInfo(output), ['video,320,240', 'audio']);
});

test('отмена останавливает ffmpeg и удаляет временный файл', options, async t => {
  const { root, video } = await sampleVideo(t);
  const plan = await planCut({ sourcePath: video, ranges: [{ start: 10, end: 20 }], duration: 60, precise: true });
  const output = path.join(root, 'out.tmp');
  const job = executeCut({ sourcePath: video, outputPath: output, plan });
  job.cancel();
  await assert.rejects(job.promise, { code: 'ECANCELED' });
  await assert.rejects(stat(output), { code: 'ENOENT' });
});

test('runFfmpeg отменяется во время работы', options, async () => {
  const job = runFfmpeg(['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=600:size=1280x720:rate=30', '-f', 'null', '-']);
  setTimeout(() => job.cancel(), 300);
  await assert.rejects(job.promise, { code: 'ECANCELED' });
});

test('короткий фрагмент в режиме копирования расширяется до ключевого кадра, а не отклоняется', options, async t => {
  const { video } = await sampleVideo(t);
  const plan = await planCut({ sourcePath: video, ranges: [{ start: 0, end: 1.8 }], duration: 60, precise: false });
  assert.deepEqual(plan.ranges, [{ start: 0, end: 2 }]);
});

function frameHashes(file) {
  const output = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-an', '-vsync', '0', '-f', 'framemd5', '-'], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 }).stdout;
  return output.split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => line.split(',').pop().trim());
}

// Копирование без перекодирования: все кадры результата — исходные, остаток после выреза начинается ровно
// с ключевого кадра; из-за B-кадров в начале выреза могут остаться несколько его кадров (доли секунды).
test('после копирования кадры результата — исходные, склейки на своих местах', options, async t => {
  const { root, video } = await sampleVideo(t);
  const plan = await planCut({ sourcePath: video, ranges: [{ start: 10, end: 20 }, { start: 30, end: 36 }], duration: 60, precise: false });
  assert.deepEqual(plan.ranges, [{ start: 10, end: 20 }, { start: 30, end: 36 }]);
  const output = path.join(root, 'out.tmp');
  await executeCut({ sourcePath: video, outputPath: output, plan }).promise;
  const result = path.join(root, 'result.mp4');
  require('node:fs').renameSync(output, result);
  const source = frameHashes(video);
  const index = new Map(source.map((hash, position) => [hash, position]).reverse());
  const mapped = frameHashes(result).map(hash => index.has(hash) ? index.get(hash) : -1);
  assert.ok(!mapped.includes(-1), 'в результате есть кадры, которых нет в исходнике');
  // 30 кадров в секунду: оставлены 0–10 с (кадры 0–299), 20–30 с (600–899) и 36–60 с (1080–1799).
  const kept = frame => frame < 300 || (frame >= 600 && frame < 900) || frame >= 1080;
  for (let frame = 0; frame < 1800; frame++) if (kept(frame)) assert.ok(mapped.includes(frame), `потерян оставляемый кадр ${frame}`);
  assert.deepEqual(mapped.filter(kept), mapped.filter(kept).slice().sort((a, b) => a - b), 'порядок оставленных кадров нарушен');
  const leaks = [mapped.filter(frame => frame >= 300 && frame < 600), mapped.filter(frame => frame >= 900 && frame < 1080)];
  assert.ok(leaks.every(list => list.length <= 6 && list.every(frame => frame === 300 || frame === 900 || frame < 306 || (frame >= 900 && frame < 906))), `лишние кадры у склеек: ${JSON.stringify(leaks)}`);
});

test('нельзя вырезать видео целиком', options, async t => {
  const { video } = await sampleVideo(t);
  await assert.rejects(planCut({ sourcePath: video, ranges: [{ start: 0, end: 60 }], duration: 60, precise: true }), /хотя бы 1 секунда/);
});
