# Folder-video

[Русская версия](README.ru.md)

Folder-video is a local desktop app for finding the right moment in a video folder. It shows each file as a strip of frames, then opens the selected video in its own tab with a detailed frame grid.
Resize the frame and transcript sidebar by dragging its left edge. The app saves the selected width; with the divider focused, use the left and right arrow keys.

![Frame-by-frame video review](docs/screens/video-review.png)

## Screenshots

<table>
  <tr>
    <td><img src="docs/screens/video-library.png" alt="Video library with frame strips and page navigation"></td>
    <td><img src="docs/screens/settings.png" alt="Folder-video settings for metadata storage and frame-grid preferences"></td>
  </tr>
</table>

## What it does

- Opens a local folder from the native picker, by drag and drop, or from Windows Explorer after installing the optional context-menu integration.
- Scans supported video files, including subfolders when requested, and lets you filter by name or last-modified age, hide zero-byte files, sort by date, name, or file size, and page through the results.
- Opens several videos in tabs. Each tab has standard playback controls, a dedicated play/pause button, selectable playback speeds, and a frame grid for seeking by click or drag.
- Restores open tabs in their saved order, the active tab, the selected folder, and each video's playback position and viewing options on the next launch. Restored videos stay paused; unavailable files are skipped. Closed tabs stay closed.
- Keeps up to ten recent folders, favourite videos, and up to thirty recently viewed videos across launches. Each recent-video entry can be removed without deleting its file.
- Stores a title, YouTube link, Obsidian link, Markdown notes, and tags in JSON files keyed by the video's SHA-256 content hash. The metadata stays with the same file after it is moved.
- Can save the current frame, copy the filename without its extension, reveal the file, open it in the system player, move it, or send it to the Windows Recycle Bin after confirmation.
- Creates a two-times-speed copy with FFmpeg when `ffmpeg` is available on `PATH`.
- A YouTube-source button left of the ♡ in the player: grey when the file's Explorer property «URL-адрес автора» (`System.Media.AuthorUrl`) is empty, red when it holds a YouTube link (click opens it in the browser). When empty, a click asks permission, then searches YouTube by the file name (the `(RU)`/`_2x` suffixes are stripped; `yt-dlp` from `PATH` is used if present, otherwise the search page is parsed), picks the result whose duration is within 2 s of the file automatically or lets you choose among five, and writes the canonical `https://www.youtube.com/watch?v=<id>` link through the Windows Property System. Creation and modification dates are restored after the write. Only `mp4`, `m4v` and `mov` are writable; the button is disabled for other formats.
  Existing links entered through Explorer are read from the same property (`PKEY_Media_AuthorUrl`, property ID 32), including URLs with a playback timestamp. The app and `scripts/set_youtube_source.py` both use this field; Windows integration tests verify reading, writing, and preserved file dates.
- Cuts fragments out of a video right in the player (✂ button or the `I` key): `I` and `O` mark the start and end, handles on the waveform strip (with zoom buttons and `Ctrl+wheel`) adjust them, several fragments are removed in one pass, and `X` starts the cut. By default it copies streams without re-encoding (seconds, same format and resolution); boundaries snap to keyframes and the real result is shown before you run it, while the "Точно" checkbox re-encodes for frame accuracy. The original moves to `.fv-undo` next to the video and `Ctrl+Z` or a click on the toast restores it; backups older than 7 days are removed on startup, and Settings lists them with restore and clear buttons. Notes are re-timed, metadata is copied to the new hash, and the transcript and summary are marked stale. Requires `ffmpeg` and `ffprobe` on `PATH`; Settings can disable replacing the original, in which case the result is saved as `<name> (cut).ext`. `folder-video://` links in already exported Obsidian articles shift after a cut.
- Transcribes a video on demand with the local Parakeet TDT 0.6B v3 GGUF model through `transcribe.dll`. The right panel switches between frame thumbnails and clickable SRT segments; a segment seeks the player to its timestamp. The active segment scrolls to the center of the transcript panel during playback and when the panel opens.
- With a DeepSeek API key in Settings, automatically creates a Russian overview and up to ten linked topics from the transcript. Click a topic to seek to its source segment. The summary is stored beside the transcript as `<video-stem>.summary.json`; the API key is stored separately using Electron's encrypted storage.
- The document split button in the side-panel header: clicking it saves the summary as an Obsidian article (`Сводка — <video name>.md`) into the folder set in Settings (default `C:\_ObsidianDB\ai-study\00 Inbox`): ten frames at the same positions as the list strip (generated with system `ffmpeg` into `images/` next to the note), the overview and topics. Topic timestamps and the time links under the frames are `folder-video://open?path=…&t=<seconds>` links; the packaged app registers this protocol and opens the video in the Windows default player for its extension, starting at that second (VLC, mpv, MPC-HC/BE and PotPlayer; other players open the file from the beginning). The Folder-video window is not opened for these links. Clicking again asks for confirmation and then overwrites the article and frames. The dropdown has "Дополнить статью" (appends the current summary as a new section at the end of the existing article, keeping manual edits) and "Открыть статью" (opens it in Obsidian).
- Keeps timestamped video notes in a separate `<video-stem>.notes.md` file in the transcripts folder (default `%APPDATA%\folder-video\transcripts`; change it in Settings → Транскрибация → «Папка транскрипций», existing files are not moved). Pause to write in the field below the player; playback saves the text and shows a matching note for ten seconds of video time. The Notes panel has a raw `[10:40]` / `---` editor and clickable links to each note.

## Install and start

If you have received `folder-video-setup.exe`, run it and follow the Windows installer. It creates Start menu and desktop shortcuts.
If the pinned Start menu tile shows a blank page after an update, unpin that tile and pin Folder-video again from the app list.

The installed Windows x64 app checks for updates ten seconds after launch. Settings → «Обновления» lets you disable startup checks or check manually. When a newer release is found, choose «Обновить» to download it, install it, and restart the app, or «Позже» to keep working. The download shows progress and is checked against the release size and GitHub's SHA-256 digest when provided. Finish video processing and save pending metadata or settings before updating; notes are saved before restart. Portable and development builds require a manual installer. Versions released before this feature need one manual update to gain the updater.

If version 1.0.21 or 1.0.22 downloads an update and closes without installing it, run the installer for 1.0.23 or later manually once. These versions can exit before their Windows update helper executes its script; 1.0.23 fixes the helper launch.

To build the installer from source, use the instructions in the [technical documentation](docs/README.md). The portable build is a folder at `out\\folder-video-win32-x64`; keep its files together and run `folder-video.exe` from that folder.

## Everyday use

Settings use the same dark or light palette and purple accent as the rest of the app.

1. Choose a folder or drop one into the window.
2. Use the frame strips, filter, and sort controls to find a video.
3. Open a video row. Adjust the number of frame-grid columns, the time interval, and automatic scrolling if needed.
4. Click or drag across the grid to seek. The arrow keys, Home, End, and Space also control the player; Space toggles play/pause.
5. Add notes and tags in the metadata panel, then save them.
6. For timed notes, pause at the desired moment and type below the player. In the Notes panel, edit the full text with `[m:ss]` headers and `---` separator lines; changes save automatically. The editor starts collapsed; the button beside its heading expands it, while the note links remain visible in time order. Click a note in the list to seek to its time and return focus to the playback control, so Space pauses the video.

## Supported files and limits

Folder-video scans `mp4`, `webm`, `mov`, `avi`, `mkv`, `m4v`, and `ogv` files. Whether a file plays also depends on its codec support in Chromium.

The full feature set targets Windows 10 and Windows 11. Windows Explorer integration, Recycle Bin deletion, preserved timestamps on accelerated copies, file moves, and Parakeet transcription are Windows features. Video content stays local; when summarization is enabled, transcript text is sent to the DeepSeek API. FFmpeg, FFprobe, and Python must be available on `PATH` for transcription. The model file `parakeet-tdt-0.6b-v3-Q8_0.gguf` is found in the HuggingFace cache, or you can specify its path in Settings. Transcripts and summaries are stored in the app profile, not beside the portable executable. A summary is regenerated when its source transcript or selected DeepSeek model changes. Failed requests can be retried from the Summary tab.

[Technical documentation](docs/README.md)

Maintainers: [build and publish a Windows release](BUILDING-WINDOWS.md#выпустить-новую-версию) with `python scripts/release.py`; use `--dry-run` to build without publishing.
Run `bash clear.sh` in Git Bash to remove build output and dependencies; run `bun install` before building again.

## License

MIT.
