"use strict";

// Чтение и запись свойств Проводника через Windows Property System: «URL-адрес автора» (System.Media.AuthorUrl)
// и «Дата выпуска» (System.Media.DateReleased) — дата публикации ролика на YouTube.
// Запуск — только из main.js. Даты создания и изменения файла запоминаются до записи и возвращаются после неё.

const { spawn } = require('node:child_process');
const { normalizePublishedDate } = require('../shared/published-date-core');

const POWERSHELL_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FvAuthorUrl {
  [StructLayout(LayoutKind.Sequential, Pack = 4)] public struct PROPERTYKEY { public Guid fmtid; public uint pid; }
  [StructLayout(LayoutKind.Explicit, Size = 24)] public struct PROPVARIANT {
    [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; [FieldOffset(8)] public uint cElems; [FieldOffset(16)] public IntPtr pElems;
  }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropertyStore {
    [PreserveSig] int GetCount(out uint c);
    [PreserveSig] int GetAt(uint i, out PROPERTYKEY k);
    [PreserveSig] int GetValue(ref PROPERTYKEY k, out PROPVARIANT v);
    [PreserveSig] int SetValue(ref PROPERTYKEY k, ref PROPVARIANT v);
    [PreserveSig] int Commit();
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  static extern int SHGetPropertyStoreFromParsingName(string path, IntPtr bc, int flags, ref Guid riid, out IPropertyStore store);
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref PROPVARIANT v);
  // pid 32 — System.Media.AuthorUrl, pid 100 — System.Media.DateReleased (разные fmtid).
  static PROPERTYKEY Key(uint pid) { PROPERTYKEY k; k.fmtid = new Guid(pid == 100 ? "DE41CC29-6971-4290-B472-F59F2E2F31E2" : "64440492-4C8B-11D1-8B70-080036B11A03"); k.pid = pid; return k; }
  static IPropertyStore Open(string path, int flags) {
    Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"); IPropertyStore store;
    Marshal.ThrowExceptionForHR(SHGetPropertyStoreFromParsingName(path, IntPtr.Zero, flags, ref iid, out store));
    return store;
  }
  public static string Read(string path, uint pid) {
    IPropertyStore store = Open(path, 0); PROPERTYKEY key = Key(pid); PROPVARIANT v;
    Marshal.ThrowExceptionForHR(store.GetValue(ref key, out v));
    try {
      if (v.vt == 31 && v.p != IntPtr.Zero) return Marshal.PtrToStringUni(v.p);
      if (v.vt == (0x1000 | 31) && v.cElems > 0 && v.pElems != IntPtr.Zero) { IntPtr first = Marshal.ReadIntPtr(v.pElems); return first == IntPtr.Zero ? "" : Marshal.PtrToStringUni(first); }
      return "";
    } finally { PropVariantClear(ref v); Marshal.ReleaseComObject(store); }
  }
  public static void Write(string path, uint pid, string value) {
    IPropertyStore store = Open(path, 2); PROPERTYKEY key = Key(pid);
    PROPVARIANT v = new PROPVARIANT(); v.vt = 31; v.p = Marshal.StringToCoTaskMemUni(value);
    try {
      Marshal.ThrowExceptionForHR(store.SetValue(ref key, ref v));
      Marshal.ThrowExceptionForHR(store.Commit());
    } finally { PropVariantClear(ref v); Marshal.ReleaseComObject(store); }
  }
}
'@
$path = $env:FOLDER_VIDEO_FILE
function ReadPublished { try { [FvAuthorUrl]::Read($path, 100) } catch { '' } }
if ($env:FOLDER_VIDEO_MODE -eq 'read') {
  @{ url = [FvAuthorUrl]::Read($path, 32); published = ReadPublished } | ConvertTo-Json -Compress
} else {
  $item = Get-Item -LiteralPath $path -Force
  $created = $item.CreationTimeUtc.Ticks; $modified = $item.LastWriteTimeUtc.Ticks
  if ($env:FOLDER_VIDEO_MODE -eq 'write') { [FvAuthorUrl]::Write($path, 32, $env:FOLDER_VIDEO_URL) }
  if ($env:FOLDER_VIDEO_DATE) { [FvAuthorUrl]::Write($path, 100, $env:FOLDER_VIDEO_DATE) }
  $item = Get-Item -LiteralPath $path -Force
  $restored = $true
  if ($item.CreationTimeUtc.Ticks -ne $created) { [IO.File]::SetCreationTimeUtc($path, [DateTime]::new($created, 'Utc')); $restored = $false }
  if ($item.LastWriteTimeUtc.Ticks -ne $modified) { [IO.File]::SetLastWriteTimeUtc($path, [DateTime]::new($modified, 'Utc')); $restored = $false }
  $item = Get-Item -LiteralPath $path -Force
  $intact = ($item.CreationTimeUtc.Ticks -eq $created) -and ($item.LastWriteTimeUtc.Ticks -eq $modified)
  @{ url = [FvAuthorUrl]::Read($path, 32); published = ReadPublished; datesChangedAndRestored = (-not $restored); datesIntact = $intact } | ConvertTo-Json -Compress
}
`;

function runPowerShell(mode, filePath, url, date) {
  const encoded = Buffer.from(POWERSHELL_SCRIPT, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true, env: { ...process.env, FOLDER_VIDEO_MODE: mode, FOLDER_VIDEO_FILE: filePath, FOLDER_VIDEO_URL: url || '', FOLDER_VIDEO_DATE: date || '' }
    });
    let output = ''; let errors = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Превышено время ожидания свойств файла')); }, 20000);
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(errors.replace(/\s+/g, ' ').trim().slice(0, 300) || 'Не удалось обработать свойство файла'));
      try { resolve(JSON.parse(output.trim().split(/\r?\n/).pop())); } catch { reject(new Error('Неожиданный ответ PowerShell')); }
    });
  });
}

async function readAuthorUrl(filePath) {
  if (process.platform !== 'win32') return { supported: false, url: '' };
  const result = await runPowerShell('read', filePath);
  return { supported: true, url: typeof result.url === 'string' ? result.url : '', published: normalizePublishedDate(result.published) };
}

// date — "YYYY-MM-DD" (необязательно): дата публикации записывается тем же проходом вместе со ссылкой.
async function writeAuthorUrl(filePath, url, date = '') {
  if (process.platform !== 'win32') throw new Error('Запись свойства поддерживается только в Windows');
  const result = await runPowerShell('write', filePath, url, normalizePublishedDate(date));
  return { ...result, published: normalizePublishedDate(result.published) };
}

// Только дата публикации (ссылка уже записана).
async function writePublishedDate(filePath, date) {
  if (process.platform !== 'win32') throw new Error('Запись свойства поддерживается только в Windows');
  const normalized = normalizePublishedDate(date);
  if (!normalized) throw new Error('Некорректная дата публикации');
  const result = await runPowerShell('writeDate', filePath, '', normalized);
  return { ...result, published: normalizePublishedDate(result.published) };
}

module.exports = { readAuthorUrl, writeAuthorUrl, writePublishedDate };
