const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readAuthorUrl, writeAuthorUrl } = require('./author-url-property');

function windowsProperty(file, mode, url = '') {
  // Независимый эталон: Windows разрешает каноническое имя, без номера свойства из приложения.
  const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($env:FV_PROPERTY_MODE -eq 'write') {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PropertyFixture {
  [StructLayout(LayoutKind.Sequential, Pack = 4)] public struct Key { public Guid id; public uint pid; }
  [StructLayout(LayoutKind.Explicit, Size = 24)] public struct Value {
    [FieldOffset(0)] public ushort type; [FieldOffset(8)] public IntPtr text;
  }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface Store {
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int GetAt(uint index, out Key key);
    [PreserveSig] int GetValue(ref Key key, out Value value);
    [PreserveSig] int SetValue(ref Key key, ref Value value);
    [PreserveSig] int Commit();
  }
  [DllImport("propsys.dll", CharSet = CharSet.Unicode)]
  static extern int PSGetPropertyKeyFromName(string name, out Key key);
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  static extern int SHGetPropertyStoreFromParsingName(string path, IntPtr context, int flags, ref Guid iid, out Store store);
  public static void Write(string file, string url) {
    Key key; Marshal.ThrowExceptionForHR(PSGetPropertyKeyFromName("System.Media.AuthorUrl", out key));
    Guid iid = typeof(Store).GUID; Store store;
    Marshal.ThrowExceptionForHR(SHGetPropertyStoreFromParsingName(file, IntPtr.Zero, 2, ref iid, out store));
    Value value = new Value(); value.type = 31; value.text = Marshal.StringToCoTaskMemUni(url);
    try {
      Marshal.ThrowExceptionForHR(store.SetValue(ref key, ref value));
      Marshal.ThrowExceptionForHR(store.Commit());
    } finally { Marshal.FreeCoTaskMem(value.text); Marshal.ReleaseComObject(store); }
  }
}
'@
  [PropertyFixture]::Write($env:FV_PROPERTY_FILE, $env:FV_PROPERTY_URL)
}
$file = Get-Item -LiteralPath $env:FV_PROPERTY_FILE
$shell = New-Object -ComObject Shell.Application
$folder = $shell.NameSpace($file.DirectoryName)
$item = $folder.ParseName($file.Name)
@{ url = $item.ExtendedProperty('System.Media.AuthorUrl') } | ConvertTo-Json -Compress
`;
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    windowsHide: true, timeout: 20000, encoding: 'utf8', stdio: 'pipe',
    env: { ...process.env, FV_PROPERTY_FILE: file, FV_PROPERTY_MODE: mode, FV_PROPERTY_URL: url }
  });
  return JSON.parse(output.trim());
}

function batchProperty(mode, file, url = '') {
  const source = readFileSync(path.join(__dirname, 'scripts', 'set_youtube_source.py'), 'utf8');
  const match = /POWERSHELL = r'''([\s\S]*?)'''/.exec(source);
  assert.ok(match, 'PowerShell-код пакетного скрипта найден');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(match[1], 'utf16le').toString('base64')], {
    windowsHide: true, timeout: 20000, encoding: 'utf8', stdio: 'pipe',
    env: { ...process.env, FOLDER_VIDEO_FILE: file, FOLDER_VIDEO_MODE: mode, FOLDER_VIDEO_URL: url }
  });
  return JSON.parse(output.trim());
}

test('Windows: ссылка автора из Проводника читается, запись видна Проводнику и сохраняет даты', { skip: process.platform !== 'win32' }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fv-author-url-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 30 }));
  const file = path.join(root, 'Видео (RU)_2x.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=32x32:r=1', '-t', '1', '-c:v', 'libx264', file], { windowsHide: true, timeout: 15000 });
  assert.equal((await readAuthorUrl(file)).url, '');
  const original = 'https://www.youtube.com/watch?v=J5pxecFSO-4&t=1s';
  assert.equal(windowsProperty(file, 'write', original).url, original);
  assert.equal((await readAuthorUrl(file)).url, original);
  assert.equal(batchProperty('read', file).url, original);

  for (const [write, replacement] of [
    [writeAuthorUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    [(filePath, url) => batchProperty('write', filePath, url), original]
  ]) {
    const before = await fs.stat(file);
    const result = await write(file, replacement);
    assert.equal(result.url, replacement);
    assert.equal(result.datesIntact, true);
    assert.equal(windowsProperty(file, 'read').url, replacement);
    const after = await fs.stat(file);
    assert.equal(after.birthtimeMs, before.birthtimeMs);
    assert.equal(after.mtimeMs, before.mtimeMs);
  }
});
