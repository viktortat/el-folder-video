#!/usr/bin/env python
"""Проставляет свойство «URL-адрес автора» (System.Media.AuthorUrl) со ссылкой на исходник на YouTube.

Обходит видеофайлы в корне папки (без подпапок), ищет ролик на YouTube по названию файла
(без суффиксов вида " (RU)_2x") и записывает каноническую ссылку через Windows Property System.
Даты создания и изменения файла сохраняются. Тот же алгоритм, что у кнопки в приложении.

Примеры:
    python scripts/set_youtube_source.py "D:\\Videos" --dry-run
    python scripts/set_youtube_source.py "D:\\Videos"
    python scripts/set_youtube_source.py "D:\\Videos" --ask
"""
import argparse
import base64
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request

WRITABLE_EXTENSIONS = {'.mp4', '.m4v', '.mov'}
SKIPPED_EXTENSIONS = {'.webm', '.avi', '.mkv', '.ogv'}
TOLERANCE_SECONDS = 2
MAX_CANDIDATES = 5
VIDEO_EXT = re.compile(r'\.(mp4|webm|mov|avi|mkv|m4v|ogv)$', re.I)
LANGUAGE_SUFFIX = re.compile(r'\s*\((?:RU|EN|UA)\)\s*$', re.I)
SPEED_SUFFIX = re.compile(r'_\d+(?:\.\d+)?x\s*$', re.I)
VIDEO_ID = re.compile(r'^[A-Za-z0-9_-]{11}$')
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

POWERSHELL = r'''
$ErrorActionPreference = 'Stop'
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
  static PROPERTYKEY Key() { PROPERTYKEY k; k.fmtid = new Guid("64440492-4C8B-11D1-8B70-080036B11A03"); k.pid = 32; return k; }
  static IPropertyStore Open(string path, int flags) {
    Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"); IPropertyStore store;
    Marshal.ThrowExceptionForHR(SHGetPropertyStoreFromParsingName(path, IntPtr.Zero, flags, ref iid, out store));
    return store;
  }
  public static string Read(string path) {
    IPropertyStore store = Open(path, 0); PROPERTYKEY key = Key(); PROPVARIANT v;
    Marshal.ThrowExceptionForHR(store.GetValue(ref key, out v));
    try {
      if (v.vt == 31 && v.p != IntPtr.Zero) return Marshal.PtrToStringUni(v.p);
      if (v.vt == (0x1000 | 31) && v.cElems > 0 && v.pElems != IntPtr.Zero) { IntPtr first = Marshal.ReadIntPtr(v.pElems); return first == IntPtr.Zero ? "" : Marshal.PtrToStringUni(first); }
      return "";
    } finally { PropVariantClear(ref v); Marshal.ReleaseComObject(store); }
  }
  public static void Write(string path, string value) {
    IPropertyStore store = Open(path, 2); PROPERTYKEY key = Key();
    PROPVARIANT v = new PROPVARIANT(); v.vt = 31; v.p = Marshal.StringToCoTaskMemUni(value);
    try {
      Marshal.ThrowExceptionForHR(store.SetValue(ref key, ref v));
      Marshal.ThrowExceptionForHR(store.Commit());
    } finally { PropVariantClear(ref v); Marshal.ReleaseComObject(store); }
  }
}
'@
$path = $env:FOLDER_VIDEO_FILE
if ($env:FOLDER_VIDEO_MODE -eq 'read') {
  @{ url = [FvAuthorUrl]::Read($path) } | ConvertTo-Json -Compress
} else {
  $item = Get-Item -LiteralPath $path -Force
  $created = $item.CreationTimeUtc.Ticks; $modified = $item.LastWriteTimeUtc.Ticks
  [FvAuthorUrl]::Write($path, $env:FOLDER_VIDEO_URL)
  $item = Get-Item -LiteralPath $path -Force
  if ($item.CreationTimeUtc.Ticks -ne $created) { [IO.File]::SetCreationTimeUtc($path, [DateTime]::new($created, 'Utc')) }
  if ($item.LastWriteTimeUtc.Ticks -ne $modified) { [IO.File]::SetLastWriteTimeUtc($path, [DateTime]::new($modified, 'Utc')) }
  $item = Get-Item -LiteralPath $path -Force
  $intact = ($item.CreationTimeUtc.Ticks -eq $created) -and ($item.LastWriteTimeUtc.Ticks -eq $modified)
  @{ url = [FvAuthorUrl]::Read($path); datesIntact = $intact } | ConvertTo-Json -Compress
}
'''


def run_property(mode, path, url=''):
    encoded = base64.b64encode(POWERSHELL.encode('utf-16-le')).decode('ascii')
    env = dict(os.environ, FOLDER_VIDEO_MODE=mode, FOLDER_VIDEO_FILE=path, FOLDER_VIDEO_URL=url)
    result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
                            capture_output=True, text=True, encoding='utf-8', errors='replace', env=env, timeout=30)
    if result.returncode != 0:
        raise RuntimeError(re.sub(r'\s+', ' ', result.stderr).strip()[:300] or 'ошибка PowerShell')
    return json.loads(result.stdout.strip().splitlines()[-1])


def clean_title(file_name):
    title = VIDEO_EXT.sub('', file_name).strip()
    for _ in range(10):
        new = LANGUAGE_SUFFIX.sub('', SPEED_SUFFIX.sub('', title)).strip()
        if new == title:
            break
        title = new
    return title


def is_youtube_video_url(value):
    try:
        url = urllib.parse.urlparse(value)
    except ValueError:
        return False
    host = (url.hostname or '').lower()
    if url.scheme != 'https':
        return False
    if host == 'youtu.be':
        return bool(VIDEO_ID.match(url.path[1:]))
    if host in ('youtube.com', 'www.youtube.com', 'm.youtube.com'):
        if url.path == '/watch':
            return bool(VIDEO_ID.match((urllib.parse.parse_qs(url.query).get('v') or [''])[0]))
        return bool(re.match(r'^/(shorts|live|embed)/[A-Za-z0-9_-]{11}$', url.path))
    return False


def clock_to_seconds(text):
    if not re.match(r'^\d+(?::\d{1,2}){1,2}$', text or ''):
        return None
    total = 0
    for part in text.split(':'):
        total = total * 60 + int(part)
    return total


def node_text(node):
    if not isinstance(node, dict):
        return ''
    if isinstance(node.get('simpleText'), str):
        return node['simpleText']
    return ''.join(run.get('text', '') for run in node.get('runs', []))


def find_renderers(node, found):
    if isinstance(node, dict):
        renderer = node.get('videoRenderer')
        if isinstance(renderer, dict):
            found.append(renderer)
        for key, value in node.items():
            if key != 'videoRenderer':
                find_renderers(value, found)
    elif isinstance(node, list):
        for item in node:
            find_renderers(item, found)


def normalize(items):
    seen, result = set(), []
    for item in items:
        video_id = item.get('id')
        if not isinstance(video_id, str) or not VIDEO_ID.match(video_id) or video_id in seen:
            continue
        seen.add(video_id)
        result.append({'id': video_id, 'title': str(item.get('title') or '').strip(), 'channel': str(item.get('channel') or '').strip(),
                       'duration': item.get('duration'), 'url': 'https://www.youtube.com/watch?v=' + video_id})
        if len(result) >= MAX_CANDIDATES:
            break
    return result


def search_html(query):
    request = urllib.request.Request('https://www.youtube.com/results?hl=ru&search_query=' + urllib.parse.quote(query), headers={
        'User-Agent': USER_AGENT, 'Accept-Language': 'ru,en;q=0.8', 'Cookie': 'CONSENT=YES+1; SOCS=CAI'})
    with urllib.request.urlopen(request, timeout=20) as response:
        html = response.read().decode('utf-8', errors='replace')
    marker = html.find('ytInitialData')
    start = html.find('{', marker) if marker != -1 else -1
    if start == -1:
        return []
    try:
        data, _ = json.JSONDecoder().raw_decode(html[start:])
    except ValueError:
        return []
    renderers = []
    find_renderers(data, renderers)
    return normalize([{'id': item.get('videoId'), 'title': node_text(item.get('title')),
                       'channel': node_text(item.get('ownerText')) or node_text(item.get('longBylineText')),
                       'duration': clock_to_seconds(node_text(item.get('lengthText')))} for item in renderers])


def search_ytdlp(query):
    try:
        result = subprocess.run(['yt-dlp', '--flat-playlist', '--dump-json', '--no-warnings', 'ytsearch%d:%s' % (MAX_CANDIDATES, query)],
                                capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return []
    if result.returncode != 0:
        return []
    items = []
    for line in result.stdout.splitlines():
        try:
            data = json.loads(line)
        except ValueError:
            continue
        duration = data.get('duration')
        items.append({'id': data.get('id'), 'title': data.get('title'), 'channel': data.get('channel') or data.get('uploader'),
                      'duration': round(duration) if isinstance(duration, (int, float)) else None})
    return normalize(items)


def search_youtube(query):
    return search_ytdlp(query) or search_html(query)


def probe_duration(path):
    try:
        result = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                                capture_output=True, text=True, timeout=30)
        return float(result.stdout.strip())
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return None


def pick_auto(candidates, duration):
    if duration is None:
        return None
    best, best_diff = None, None
    for candidate in candidates:
        if candidate['duration'] is None:
            continue
        diff = abs(candidate['duration'] - duration)
        if best_diff is None or diff < best_diff:
            best, best_diff = candidate, diff
    return best if best is not None and best_diff <= TOLERANCE_SECONDS else None


def clock(seconds):
    seconds = int(round(seconds))
    hours, rest = divmod(seconds, 3600)
    minutes, secs = divmod(rest, 60)
    return '%d:%02d:%02d' % (hours, minutes, secs) if hours else '%d:%02d' % (minutes, secs)


def choose_manually(candidates, duration):
    print('    Точного совпадения по длительности нет (файл: %s):' % (clock(duration) if duration else '?'))
    for number, candidate in enumerate(candidates, 1):
        length = clock(candidate['duration']) if candidate['duration'] is not None else '?'
        print('    %d) %s — %s [%s]  %s' % (number, candidate['title'], candidate['channel'], length, candidate['url']))
    answer = input('    Номер (Enter — пропустить): ').strip()
    return candidates[int(answer) - 1] if answer.isdigit() and 1 <= int(answer) <= len(candidates) else None


def list_videos(folder):
    names = sorted(os.listdir(folder), key=str.lower)
    return [name for name in names if os.path.isfile(os.path.join(folder, name)) and not os.path.islink(os.path.join(folder, name))
            and os.path.splitext(name)[1].lower() in WRITABLE_EXTENSIONS | SKIPPED_EXTENSIONS]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('folder', help='папка с видео (подпапки не обходятся)')
    parser.add_argument('--dry-run', action='store_true', help='только показать найденное, ничего не записывать')
    parser.add_argument('--ask', action='store_true', help='при неточном совпадении длительности спрашивать выбор в консоли (иначе файл пропускается)')
    parser.add_argument('--delay', type=float, default=1.5, help='пауза между запросами к YouTube, секунды (по умолчанию 1.5)')
    args = parser.parse_args()

    if sys.platform != 'win32':
        sys.exit('Скрипт работает только в Windows: свойство пишется через Windows Property System.')
    folder = os.path.abspath(args.folder)
    if not os.path.isdir(folder):
        sys.exit('Папка не найдена: ' + folder)
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')

    stats = {'written': 0, 'has_link': 0, 'unsupported': 0, 'not_found': 0, 'ambiguous': 0, 'errors': 0}
    files = list_videos(folder)
    print('Видео в корне папки: %d' % len(files))
    for name in files:
        path = os.path.join(folder, name)
        print('\n' + name)
        if os.path.splitext(name)[1].lower() not in WRITABLE_EXTENSIONS:
            print('    пропуск: формат не поддерживает запись свойства')
            stats['unsupported'] += 1
            continue
        try:
            existing = run_property('read', path).get('url', '')
        except Exception as error:
            print('    ошибка чтения свойства: %s' % error)
            stats['errors'] += 1
            continue
        if is_youtube_video_url(existing):
            print('    уже есть: ' + existing)
            stats['has_link'] += 1
            continue
        query = clean_title(name)
        if not query:
            print('    пропуск: пустое название для поиска')
            stats['not_found'] += 1
            continue
        try:
            candidates = search_youtube(query)
        except Exception as error:
            print('    ошибка поиска «%s»: %s' % (query, error))
            stats['errors'] += 1
            continue
        finally:
            time.sleep(args.delay)
        if not candidates:
            print('    не найдено: «%s»' % query)
            stats['not_found'] += 1
            continue
        duration = probe_duration(path)
        chosen = pick_auto(candidates, duration)
        if chosen is None:
            if args.ask:
                chosen = choose_manually(candidates, duration)
            else:
                print('    неоднозначно (длительность не совпала в пределах %d с), пропуск; используйте --ask. Лучший: %s' % (TOLERANCE_SECONDS, candidates[0]['url']))
            if chosen is None:
                stats['ambiguous'] += 1
                continue
        print('    найдено: %s — %s' % (chosen['title'], chosen['url']))
        if args.dry_run:
            continue
        try:
            result = run_property('write', path, chosen['url'])
        except Exception as error:
            print('    ошибка записи: %s' % error)
            stats['errors'] += 1
            continue
        stats['written'] += 1
        print('    записано' + ('' if result.get('datesIntact') else ' (внимание: даты файла не удалось полностью сохранить)'))

    print('\nИтог: записано %(written)d, уже были %(has_link)d, не найдено %(not_found)d, неоднозначно %(ambiguous)d, '
          'формат не поддерживается %(unsupported)d, ошибок %(errors)d' % stats)


if __name__ == '__main__':
    main()
