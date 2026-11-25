"use strict";

// Чтение и запись свойств Проводника через Windows Property System: «URL-адрес автора» (System.Media.AuthorUrl)
// и дата публикации ролика на YouTube. Дата пишется в «Издатель» (System.Media.Publisher, ISO-строка: её показывает окно
// «Свойства → Подробно»; «Дата создания мультимедиа» (System.Media.DateEncoded) для mp4 там пустая, хотя значение хранится)
// и в System.Media.DateEncoded. Старые файлы с датой в «Дате выпуска» (System.Media.DateReleased) читаются как запасной вариант.
// Запуск — только из main.js. Даты создания и изменения файла запоминаются до записи и возвращаются после неё.
// Чтение идёт напрямую из бокса Xtra (mp4-xtra.js, миллисекунды); PowerShell нужен для записи и как запасной путь чтения.

const { spawn } = require('node:child_process');
const { normalizePublishedDate } = require('../shared/published-date-core');
const { readXtraProperties } = require('./mp4-xtra');

// HRESULT 0x80070020 / 0x80070021: файл открыт другим процессом (обычно плеером).
const SHARING_VIOLATIONS = new Set([-2147024864, -2147024863]);

// String.raw: в скрипте есть \x и \u для экранирования ответа.
const POWERSHELL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Ответ — одна строка JSON только из ASCII: русские тексты ошибок не зависят от кодовой страницы консоли.
function Write-Answer($value) {
  $json = ConvertTo-Json -InputObject $value -Compress
  [Console]::Out.WriteLine([regex]::Replace($json, '[^\x00-\x7F]', { param($m) '\u{0:x4}' -f [int][char]$m.Value }))
}
try {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FvAuthorUrl {
  [StructLayout(LayoutKind.Sequential, Pack = 4)] public struct PROPERTYKEY { public Guid fmtid; public uint pid; }
  [StructLayout(LayoutKind.Explicit, Size = 24)] public struct PROPVARIANT {
    [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public long ft; [FieldOffset(8)] public IntPtr p; [FieldOffset(8)] public uint cElems; [FieldOffset(16)] public IntPtr pElems;
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
  // pid 32 — System.Media.AuthorUrl, pid 100 — System.Media.DateReleased (разные fmtid); DateEncoded — отдельный ключ.
  static PROPERTYKEY EncodedKey() { PROPERTYKEY k; k.fmtid = new Guid("2E4B640D-5019-46D8-8881-55414CC5CAAA"); k.pid = 100; return k; }
  // Дата как FILETIME в полдень UTC: в любом часовом поясе остаётся тот же календарный день. Возвращает "yyyy-MM-dd" или "".
  public static string ReadDate(string path) {
    IPropertyStore store = Open(path, 0); PROPERTYKEY key = EncodedKey(); PROPVARIANT v;
    Marshal.ThrowExceptionForHR(store.GetValue(ref key, out v));
    try {
      if (v.vt == 64 && v.ft > 0) return DateTime.FromFileTimeUtc(v.ft).ToString("yyyy-MM-dd");
      return "";
    } finally { PropVariantClear(ref v); Marshal.ReleaseComObject(store); }
  }
  const string MediaFmt = "64440492-4C8B-11D1-8B70-080036B11A03";
  public static string ReadPublisher(string path) {
    IPropertyStore store = Open(path, 0); PROPERTYKEY key; key.fmtid = new Guid(MediaFmt); key.pid = 30; PROPVARIANT v;
    Marshal.ThrowExceptionForHR(store.GetValue(ref key, out v));
    try { return v.vt == 31 && v.p != IntPtr.Zero ? Marshal.PtrToStringUni(v.p) : ""; }
    finally { PropVariantClear(ref v); Marshal.ReleaseComObject(store); }
  }
  public static void WritePublisher(string path, string value) {
    IPropertyStore store = Open(path, 2); PROPERTYKEY key; key.fmtid = new Guid(MediaFmt); key.pid = 30;
    PROPVARIANT v = new PROPVARIANT(); v.vt = 31; v.p = Marshal.StringToCoTaskMemUni(value);
    try { Marshal.ThrowExceptionForHR(store.SetValue(ref key, ref v)); Marshal.ThrowExceptionForHR(store.Commit()); }
    finally { PropVariantClear(ref v); Marshal.ReleaseComObject(store); }
  }
  public static void WriteDate(string path, string value) {
    DateTime day = DateTime.ParseExact(value, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
    IPropertyStore store = Open(path, 2); PROPERTYKEY key = EncodedKey();
    PROPVARIANT v = new PROPVARIANT(); v.vt = 64; v.ft = new DateTime(day.Year, day.Month, day.Day, 12, 0, 0, DateTimeKind.Utc).ToFileTimeUtc();
    try {
      Marshal.ThrowExceptionForHR(store.SetValue(ref key, ref v));
      Marshal.ThrowExceptionForHR(store.Commit());
    } finally { Marshal.ReleaseComObject(store); }
  }
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
# Запись в копию: даты создания и изменения берутся у оригинала, чтобы после подмены они остались прежними.
$timesFrom = if ($env:FOLDER_VIDEO_TIMES_FROM) { $env:FOLDER_VIDEO_TIMES_FROM } else { $path }
function ReadPublished {
  $date = ''
  try { $p = [FvAuthorUrl]::ReadPublisher($path); if ($p -match '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') { $date = $p } } catch { }
  if (-not $date) { try { $date = [FvAuthorUrl]::ReadDate($path) } catch { } }
  if (-not $date) { try { $date = [FvAuthorUrl]::Read($path, 100) } catch { } }
  $date
}
if ($env:FOLDER_VIDEO_MODE -eq 'read') {
  Write-Answer @{ url = [FvAuthorUrl]::Read($path, 32); published = ReadPublished }
} else {
  $item = Get-Item -LiteralPath $timesFrom -Force
  $created = $item.CreationTimeUtc.Ticks; $modified = $item.LastWriteTimeUtc.Ticks
  if ($env:FOLDER_VIDEO_MODE -eq 'write') { [FvAuthorUrl]::Write($path, 32, $env:FOLDER_VIDEO_URL) }
  if ($env:FOLDER_VIDEO_DATE) {
    [FvAuthorUrl]::WriteDate($path, $env:FOLDER_VIDEO_DATE)
    $existing = ''; try { $existing = [FvAuthorUrl]::ReadPublisher($path) } catch { }
    if (-not $existing -or $existing -match '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') { [FvAuthorUrl]::WritePublisher($path, $env:FOLDER_VIDEO_DATE) }
  }
  $item = Get-Item -LiteralPath $path -Force
  $restored = $true
  if ($item.CreationTimeUtc.Ticks -ne $created) { [IO.File]::SetCreationTimeUtc($path, [DateTime]::new($created, 'Utc')); $restored = $false }
  if ($item.LastWriteTimeUtc.Ticks -ne $modified) { [IO.File]::SetLastWriteTimeUtc($path, [DateTime]::new($modified, 'Utc')); $restored = $false }
  $item = Get-Item -LiteralPath $path -Force
  $intact = ($item.CreationTimeUtc.Ticks -eq $created) -and ($item.LastWriteTimeUtc.Ticks -eq $modified)
  Write-Answer @{ url = [FvAuthorUrl]::Read($path, 32); published = ReadPublished; datesChangedAndRestored = (-not $restored); datesIntact = $intact }
}
} catch {
  $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }
  Write-Answer @{ error = $e.Message; hresult = $e.HResult }
  exit 1
}
`;

function answerError(answer) {
  if (SHARING_VIOLATIONS.has(answer.hresult)) return new Error('Файл занят другой программой — закройте её и повторите');
  return new Error(answer.error || 'Не удалось обработать свойство файла');
}

function runPowerShell(mode, filePath, url, date, timesFrom) {
  const encoded = Buffer.from(POWERSHELL_SCRIPT, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true, env: { ...process.env, FOLDER_VIDEO_MODE: mode, FOLDER_VIDEO_FILE: filePath, FOLDER_VIDEO_URL: url || '', FOLDER_VIDEO_DATE: date || '', FOLDER_VIDEO_TIMES_FROM: timesFrom || '' }
    });
    let output = ''; let errors = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Превышено время ожидания свойств файла')); }, 20000);
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      let answer = null;
      try { answer = JSON.parse(output.trim().split(/\r?\n/).pop()); } catch { /* ответа нет — PowerShell упал до try */ }
      if (answer && answer.error !== undefined) return reject(answerError(answer));
      if (code !== 0 || !answer) return reject(new Error(code !== 0 ? `PowerShell завершился с кодом ${code}` : 'Неожиданный ответ PowerShell'));
      resolve(answer);
    });
  });
}

async function readAuthorUrl(filePath) {
  if (process.platform !== 'win32') return { supported: false, url: '' };
  try {
    const direct = await readXtraProperties(filePath);
    // Ссылка без даты: дата могла остаться в старой «Дате выпуска», которую видит только обработчик Windows.
    if (!direct.url || direct.published) return { supported: true, url: direct.url, published: normalizePublishedDate(direct.published) };
  } catch { /* не MP4-структура или ошибка чтения — спросим обработчик Windows */ }
  const result = await runPowerShell('read', filePath);
  return { supported: true, url: typeof result.url === 'string' ? result.url : '', published: normalizePublishedDate(result.published) };
}

// date — "YYYY-MM-DD" (необязательно): дата публикации записывается тем же проходом вместе со ссылкой.
// options.timesFrom — файл, чьи даты создания и изменения получит filePath (запись в копию перед подменой).
async function writeAuthorUrl(filePath, url, date = '', options = {}) {
  if (process.platform !== 'win32') throw new Error('Запись свойства поддерживается только в Windows');
  const result = await runPowerShell('write', filePath, url, normalizePublishedDate(date), options.timesFrom);
  return { ...result, published: normalizePublishedDate(result.published) };
}

// Только дата публикации (ссылка уже записана).
async function writePublishedDate(filePath, date, options = {}) {
  if (process.platform !== 'win32') throw new Error('Запись свойства поддерживается только в Windows');
  const normalized = normalizePublishedDate(date);
  if (!normalized) throw new Error('Некорректная дата публикации');
  const result = await runPowerShell('writeDate', filePath, '', normalized, options.timesFrom);
  return { ...result, published: normalizePublishedDate(result.published) };
}

module.exports = { readAuthorUrl, writeAuthorUrl, writePublishedDate };
