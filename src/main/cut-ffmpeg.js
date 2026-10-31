"use strict";

const { spawn } = require('node:child_process');
const { mkdtemp, rm, statfs, stat, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const core = require('./cut-core');

function cancelError() { const error = new Error('Операция отменена'); error.code = 'ECANCELED'; return error; }

// Запуск ffmpeg по имени из PATH. Возвращает promise и cancel(); при отмене promise отклоняется с кодом ECANCELED.
function runFfmpeg(arguments_, onProgress, command = 'ffmpeg') {
  let child = null;
  let canceled = false;
  const promise = new Promise((resolve, reject) => {
    let stderr = '';
    let progressBuffer = '';
    child = spawn(command, arguments_, { windowsHide: true });
    child.once('error', reject);
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    child.stdout.on('data', chunk => {
      progressBuffer += chunk.toString();
      const lines = progressBuffer.split(/\r?\n/);
      progressBuffer = lines.pop();
      if (!onProgress) return;
      lines.forEach(line => {
        const separator = line.indexOf('=');
        if (separator !== -1) onProgress(line.slice(0, separator), line.slice(separator + 1));
      });
    });
    child.once('close', code => {
      if (canceled) reject(cancelError());
      else if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `FFmpeg завершился с кодом ${code}`));
    });
  });
  return { promise, cancel() { canceled = true; if (child && child.exitCode === null) child.kill(); } };
}

// Запуск короткой утилиты (ffprobe) с захватом stdout.
function runCapture(command, arguments_) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(command, arguments_, { windowsHide: true });
    child.once('error', reject);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
    child.once('close', code => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `${command} завершился с кодом ${code}`)));
  });
}

async function probeDuration(videoPath) {
  const output = await runCapture('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', videoPath]);
  const value = Number(output.trim());
  if (!Number.isFinite(value) || value <= 0) throw new Error('Не удалось определить длительность видео.');
  return value;
}

// Метки времени ключевых кадров первого видеопотока (без обложек).
async function listKeyframes(videoPath) {
  const output = await runCapture('ffprobe', ['-v', 'error', '-select_streams', 'V:0', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', videoPath]);
  const frames = [];
  output.split(/\r?\n/).forEach(line => {
    const [time, flags] = line.split(',');
    if (flags && flags.includes('K') && time !== 'N/A') {
      const value = Number(time);
      if (Number.isFinite(value)) frames.push(value);
    }
  });
  return frames.sort((a, b) => a - b);
}

// План вырезки: реальные диапазоны, которые будут удалены, и оставшиеся отрезки.
// В режиме copy диапазоны привязываются к ключевым кадрам; в precise берутся как есть.
async function planCut({ sourcePath, ranges, duration, precise, keyframes }) {
  const problem = core.validateCut(ranges, duration);
  if (problem) throw new Error(problem);
  let effective;
  let skipped = [];
  if (precise) effective = core.normalizeRanges(ranges, duration);
  else {
    let frames;
    try { frames = keyframes || await listKeyframes(sourcePath); }
    catch (error) {
      if (error.code === 'ENOENT') { const missing = new Error('ffprobe не найден в PATH. Включите режим «Точно» или установите FFmpeg целиком.'); missing.code = 'ENOENT'; throw missing; }
      throw error;
    }
    ({ ranges: effective, skipped } = core.snapRangesToKeyframes(ranges, frames, duration));
  }
  if (!effective.length) throw new Error('После выбранных фрагментов нет ключевых кадров, без перекодирования их не вырезать. Включите режим «Точно».');
  const problemAfter = core.validateCut(effective, duration);
  if (problemAfter) throw new Error(problemAfter);
  return { precise: Boolean(precise), duration, ranges: effective, skipped, keep: core.keepSegments(effective, duration), remainder: core.remainderSeconds(effective, duration) };
}

async function ensureFreeSpace(directory, requiredBytes) {
  let info;
  try { info = await statfs(directory); } catch { return; }
  const free = Number(info.bavail) * Number(info.bsize);
  if (Number.isFinite(free) && free < requiredBytes) throw new Error('Недостаточно свободного места на диске для результата вырезки.');
}

// Выполняет вырезку во временный файл outputPath; исходный файл не трогает.
// Возвращает { promise, cancel }. При ошибке или отмене временные файлы удаляются.
function executeCut({ sourcePath, outputPath, plan, onProgress }) {
  const extension = path.extname(sourcePath);
  let running = null;
  let canceled = false;
  const promise = (async () => {
    const sourceInfo = await stat(sourcePath);
    await ensureFreeSpace(path.dirname(outputPath), Math.ceil(sourceInfo.size * 1.05));
    let workDirectory = null;
    try {
      let arguments_;
      if (plan.precise) arguments_ = core.buildReencodeArguments(sourcePath, outputPath, plan.ranges, extension);
      else {
        workDirectory = await mkdtemp(path.join(os.tmpdir(), 'folder-video-cut-'));
        const listFile = path.join(workDirectory, 'segments.txt');
        await writeFile(listFile, core.buildConcatList(path.resolve(sourcePath), plan.keep), 'utf8');
        arguments_ = core.buildCopyArguments(listFile, outputPath, extension);
      }
      if (canceled) throw cancelError();
      running = runFfmpeg(arguments_, (key, value) => {
        if (onProgress && (key === 'out_time_us' || key === 'out_time_ms') && plan.remainder > 0) onProgress(Math.max(0, Math.min(100, Number(value) / 1000000 / plan.remainder * 100)));
      });
      await running.promise;
      return { outputPath, duration: await probeDuration(outputPath).catch(() => plan.remainder) };
    } catch (error) {
      await rm(outputPath, { force: true }).catch(() => {});
      throw error;
    } finally {
      if (workDirectory) await rm(workDirectory, { recursive: true, force: true }).catch(() => {});
    }
  })();
  return { promise, cancel() { canceled = true; if (running) running.cancel(); } };
}

module.exports = { runFfmpeg, runCapture, probeDuration, listKeyframes, planCut, executeCut };
