const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const { EventEmitter } = require('node:events');
const { execFileSync, spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { RELEASES_REPO } = require('./update-core');

const source = readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const current = require('./package.json').version;
const payload = Buffer.from('test installer bytes');

function release(version = '99.0.0', bytes = payload) {
  const tag = `folder-video-v${version}`;
  const name = `folder-video-setup-${version}.exe`;
  return { tag_name: tag, body: 'Тестовое обновление', assets: [{ name, size: bytes.length,
    digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    browser_download_url: `https://github.com/${RELEASES_REPO}/releases/download/${tag}/${name}` }] };
}

async function harness(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fv-update-test-' "));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 30 }));
  const handlers = new Map();
  const windows = [];
  const events = [];
  const requests = [];
  const dialogs = [];
  const launches = [];
  const startupTimers = [];
  let ready;
  let quit = false;
  let preparations = 0;
  const paths = { temp: root, userData: path.join(root, 'profile'), documents: path.join(root, 'documents') };
  const local = path.join(root, 'Local AppData');
  const updateExe = path.join(local, 'folder_video', 'Update.exe');
  class Window {
    constructor() {
      windows.push(this);
      this.listeners = {};
      this.webContents = {
        once: (name, fn) => { this.listeners[name] = fn; },
        session: { clearCache: async () => {} },
        send: (name, value) => {
          events.push({ name, value });
          if (name === 'folder-video:update-prepare') {
            preparations++;
            queueMicrotask(() => handlers.get('folder-video:update-ready')({ sender: this.webContents }, value, options.prepareError || null));
          }
        }
      };
    }
    loadFile() { this.listeners['did-finish-load'](); }
    isDestroyed() { return false; }
    static getAllWindows() { return windows; }
  }
  const electron = {
    app: { isPackaged: options.packaged !== false, getVersion: () => current,
      getPath: name => paths[name], getAppPath: () => __dirname,
      setAppUserModelId() {}, setAsDefaultProtocolClient() {}, requestSingleInstanceLock: () => true,
      on() {}, whenReady: () => ({ then: fn => { ready = fn; } }), quit: () => { quit = true; } },
    BrowserWindow: Window, Menu: { setApplicationMenu() {} }, nativeImage: { createFromPath() {} },
    dialog: { showMessageBox: async (...args) => { dialogs.push(args.at(-1)); return { response: options.accept ? 0 : 1 }; } },
    net: { fetch: async url => {
      requests.push(url);
      if (options.fetchError) throw new Error('offline');
      if (url.includes('api.github.com')) {
        if (options.holdFetch) await options.holdFetch;
        if (options.httpError) return new Response('', { status: 403 });
        const page = Number(new URL(url).searchParams.get('page'));
        return Response.json(options.pages ? (options.pages[page - 1] || []) : (options.releases || [release()]));
      }
      return new Response(options.download || payload);
    } }
  };
  const runtimeFs = { ...fs,
    lstat: async file => file === updateExe ? { isFile: () => true } : fs.lstat(file),
    readFile: async (file, ...args) => {
      if (file === path.join(paths.userData, 'config.json')) return JSON.stringify({ autoUpdate: options.autoUpdate !== false });
      return fs.readFile(file, ...args);
    }
  };
  const context = vm.createContext({ Buffer, URL, AbortSignal, console, queueMicrotask,
    __dirname, setTimeout: (fn, delay) => {
      if (delay === 10000) { startupTimers.push(fn); return { unref() {} }; }
      return setTimeout(fn, delay);
    }, clearTimeout,
    process: { platform: 'win32', arch: 'x64', pid: options.parentPid || process.pid, argv: ['folder-video.exe'],
      execPath: options.portable ? path.join(root, 'out/folder-video.exe') : path.join(local, 'folder_video', `app-${current}`, 'folder-video.exe'),
      env: { LOCALAPPDATA: local } },
    require: name => {
      if (name === 'electron') return { ...electron, ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) } };
      if (name === 'electron-squirrel-startup') return false;
      if (name === 'node:fs/promises') return runtimeFs;
      if (name === './cut-undo') return { UNDO_DIRECTORY: '.fv-undo', CutUndoStore: class { async prune() {} } };
      if (name === 'node:child_process') return { spawn: (...args) => {
        launches.push(args);
        const child = new EventEmitter();
        child.unref = () => {};
        queueMicrotask(() => child.emit(options.spawnError ? 'error' : 'spawn', new Error('spawn failed')));
        return child;
      } };
      return require(name);
    }
  });
  vm.runInContext(source, context, { filename: 'main.js' });
  await ready();
  await new Promise(setImmediate);
  return { root, updateExe, paths, requests, events, dialogs, launches, startupTimers, handlers,
    check: () => handlers.get('folder-video:check-update')(),
    state: () => handlers.get('folder-video:get-update-state')(),
    get quit() { return quit; }, get preparations() { return preparations; } };
}

test('IPC: portable и dev не проверяют GitHub и не запускают установщик', async t => {
  for (const options of [{ portable: true }, { packaged: false }]) {
    const h = await harness(t, options);
    assert.match((await h.check()).message, /после установки/);
    assert.equal(h.requests.length, 0);
    assert.equal(h.launches.length, 0);
  }
});

test('IPC: актуальная версия и отмена предложения не скачивают установщик', async t => {
  const latest = await harness(t, { releases: [release(current)] });
  assert.match((await latest.check()).message, /последняя версия/);
  assert.equal(latest.dialogs.length, 0);
  const later = await harness(t);
  assert.match((await later.check()).message, /Доступна версия/);
  assert.equal(later.dialogs.length, 1);
  assert.equal(later.requests.length, 1);
  assert.equal(later.quit, false);
});

test('IPC: общий список релизов просматривается дальше первой страницы', async t => {
  const h = await harness(t, { pages: [Array.from({ length: 100 }, () => ({ tag_name: 'okoshko-v99.0.0' })), [release()]] });
  assert.match((await h.check()).message, /Доступна версия 99/);
  assert.equal(h.requests.length, 2);
  assert.match(h.requests[1], /page=2/);
});

test('IPC: ручная проверка показывает ошибку GitHub, автоматическая молчит', async t => {
  const h = await harness(t, { httpError: true });
  assert.equal((await h.check()).error, true);
  assert.match(h.state().message, /403/);
  h.startupTimers[0]();
  await new Promise(setImmediate);
  assert.equal(h.state().error, false);
  assert.equal(h.state().message, '');
});

test('IPC: отключённая автопроверка сохраняется и не обращается в сеть при запуске', async t => {
  const h = await harness(t, { autoUpdate: false });
  assert.equal(h.handlers.get('folder-video:get-settings')().settings.autoUpdate, false);
  h.startupTimers[0]();
  await new Promise(setImmediate);
  assert.equal(h.requests.length, 0);
  await h.check();
  assert.equal(h.requests.length, 1);
});

test('IPC: параллельные проверки не открывают несколько предложений', async t => {
  let resolve;
  const h = await harness(t, { holdFetch: new Promise(done => { resolve = done; }) });
  const first = h.check();
  const second = await h.check();
  assert.equal(second.busy, true);
  resolve();
  await first;
  assert.equal(h.requests.length, 1);
  assert.equal(h.dialogs.length, 1);
});

test('IPC: повреждённая или неполная загрузка не закрывает приложение, временные файлы удаляются', async t => {
  for (const download of [Buffer.alloc(payload.length), Buffer.from('short'), Buffer.alloc(payload.length + 1)]) {
    const h = await harness(t, { accept: true, download });
    assert.equal((await h.check()).error, true);
    assert.equal(h.launches.length, 0);
    assert.equal(h.quit, false);
    assert.equal((await fs.readdir(h.root)).some(name => name.startsWith('folder-video-update-')), false);
  }
});

test('IPC: отказ сохранения заметок отменяет установку', async t => {
  const h = await harness(t, { accept: true, prepareError: 'Не удалось сохранить заметки' });
  assert.match((await h.check()).message, /сохранить заметки/);
  assert.equal(h.preparations, 1);
  assert.equal(h.launches.length, 0);
  assert.equal(h.quit, false);
});

test('IPC: успешное обновление проверяет загрузку, сохраняет заметки и передаёт установку отдельному процессу', async t => {
  const h = await harness(t, { accept: true });
  assert.equal((await h.check()).busy, true);
  assert.equal(h.preparations, 1);
  assert.equal(h.quit, true);
  assert.equal(h.launches.length, 1);
  const [executable, args, options] = h.launches[0];
  assert.equal(executable, 'cmd.exe');
  assert.equal(options.windowsHide, true);
  const encoded = /-EncodedCommand ([A-Za-z0-9+/=]+)"$/.exec(args.at(-1));
  assert.ok(encoded);
  const script = Buffer.from(encoded[1], 'base64').toString('utf16le');
  assert.ok(script.indexOf('Wait-Process') < script.indexOf('$installer = Start-Process'));
  assert.match(script, /--silent/);
  assert.match(script, /--processStart/);
  assert.match(script, /fv-update-test-'' /); // Апостроф в пути не выходит из строкового литерала.
  if (process.platform === 'win32') {
    const helper = path.join(h.root, 'helper.ps1');
    await fs.writeFile(helper, script, 'utf8');
    const literal = "'" + helper.replace(/'/g, "''") + "'";
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$tokens = $null; $errors = $null; [void][System.Management.Automation.Language.Parser]::ParseFile(${literal}, [ref]$tokens, [ref]$errors); if ($errors.Count) { $errors | Out-String | Write-Error; exit 1 }`], { windowsHide: true, stdio: 'pipe' });
  }
  assert.ok(h.events.some(event => event.name === 'folder-video:update-status' && event.value.message.includes('100%')));
  // Оставшийся скачанный файл — ответственность отдельного установщика.
  const directory = (await fs.readdir(h.root)).find(name => name.startsWith('folder-video-update-'));
  assert.deepEqual(await fs.readFile(path.join(h.root, directory, 'folder-video-setup.exe')), payload);
});

test('IPC: ошибка запуска помощника не закрывает приложение и позволяет повторить проверку', async t => {
  const h = await harness(t, { accept: true, spawnError: true });
  assert.match((await h.check()).message, /spawn failed/);
  assert.equal(h.quit, false);
  assert.equal(h.state().busy, false);
  assert.equal((await fs.readdir(h.root)).some(name => name.startsWith('folder-video-update-')), false);
});

test('помощник Windows: установка и перезапуск после фактического выхода родителя, сообщение при сбое', { skip: process.platform !== 'win32' }, async t => {
  const compiler = await fs.mkdtemp(path.join(os.tmpdir(), 'fv-updater-stubs-'));
  t.after(() => fs.rm(compiler, { recursive: true, force: true, maxRetries: 10, retryDelay: 30 }));
  const executable = path.join(compiler, 'stub.exe');
  // Только наши тестовые .NET-программы: установленное приложение не затрагивается.
  const csharp = `using System;
using System.IO;
public class UpdateStub {
  public static int Main(string[] args) {
    var flag = args.Length > 0 ? args[0] : "";
    File.AppendAllText(Environment.GetEnvironmentVariable("FV_UPDATE_TEST_LOG"), flag + Environment.NewLine);
    return flag == "--silent" && Environment.GetEnvironmentVariable("FV_UPDATE_TEST_FAIL") == "1" ? 5 : 0;
  }
}`;
  const build = `Add-Type -TypeDefinition @'\n${csharp}\n'@ -OutputAssembly '${executable.replace(/'/g, "''")}' -OutputType ConsoleApplication`;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(build, 'utf16le').toString('base64')], { windowsHide: true, timeout: 30000, stdio: 'pipe' });
  const bytes = await fs.readFile(executable);
  for (const fail of [false, true]) {
    // Отдельный процесс запускает помощник и выходит точно так же, как Electron.
    const parentSource = `const { spawn } = require('node:child_process');
let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const { command, args, options } = JSON.parse(input);
  const child = spawn(command, args, options);
  child.once('error', () => process.exit(1));
  child.once('spawn', () => { child.unref(); process.exit(0); });
});`;
    const parent = spawn(process.execPath, ['-e', parentSource], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    t.after(() => { if (parent.exitCode === null) parent.kill(); });
    const h = await harness(t, { accept: true, parentPid: parent.pid, releases: [release('99.0.0', bytes)], download: bytes });
    await h.check();
    assert.equal(h.launches.length, 1);
    await fs.mkdir(path.dirname(h.updateExe), { recursive: true });
    await fs.copyFile(executable, h.updateExe);
    const marker = path.join(h.root, 'calls.txt');
    const [command, args, launchOptions] = h.launches[0];
    // Важно использовать реальные options вызова, включая stdio и detached.
    const completion = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { parent.kill(); reject(new Error('Родитель не завершился')); }, 15000);
      parent.once('error', error => { clearTimeout(timeout); reject(error); });
      parent.once('exit', code => { clearTimeout(timeout); resolve(code); });
    });
    parent.stdin.end(JSON.stringify({ command, args, options: { ...launchOptions,
      env: { ...process.env, FV_UPDATE_TEST_LOG: marker, FV_UPDATE_TEST_FAIL: fail ? '1' : '0' } } }));
    assert.equal(await completion, 0);
    let calls = '';
    for (let attempt = 0; attempt < 200; attempt++) {
      calls = await fs.readFile(marker, 'utf8').catch(() => '');
      if (calls.includes('--processStart')) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.deepEqual(calls.trim().split(/\r?\n/), ['--silent', '--processStart']);
    const error = await fs.readFile(path.join(h.paths.userData, 'update-error.txt'), 'utf8').catch(() => '');
    if (fail) assert.match(error, /5/); else assert.equal(error, '');
    assert.equal((await fs.readdir(h.root)).some(name => name.startsWith('folder-video-update-')), false);
  }
});
