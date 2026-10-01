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
- Scans supported video files, including subfolders when requested, and lets you filter by name or last-modified age, hide zero-byte files, sort, and page through the results.
- Opens several videos in tabs. Each tab has standard playback controls, a dedicated play/pause button, selectable playback speeds, and a frame grid for seeking by click or drag.
- Keeps up to ten recent folders, favourite videos, and up to thirty recently viewed videos across launches. Each recent-video entry can be removed without deleting its file.
- Stores a title, YouTube link, Obsidian link, Markdown notes, and tags in JSON files keyed by the video's SHA-256 content hash. The metadata stays with the same file after it is moved.
- Can save the current frame, copy the filename without its extension, reveal the file, open it in the system player, move it, or send it to the Windows Recycle Bin after confirmation.
- Creates a two-times-speed copy with FFmpeg when `ffmpeg` is available on `PATH`.
- Transcribes a video on demand with the local Parakeet TDT 0.6B v3 GGUF model through `transcribe.dll`. The right panel switches between frame thumbnails and clickable SRT segments; a segment seeks the player to its timestamp.
- With a DeepSeek API key in Settings, automatically creates a Russian overview and up to ten linked topics from the transcript. Click a topic to seek to its source segment. The summary is stored beside the transcript as `<video-stem>.summary.json`; the API key is stored separately using Electron's encrypted storage.
- Keeps timestamped video notes in a separate `<video-stem>.notes.md` file under `%APPDATA%\folder-video\transcripts`. Pause to write in the field below the player; playback saves the text and shows a matching note for ten seconds of video time. The Notes panel has a raw `[10:40]` / `---` editor and clickable links to each note.

## Install and start

If you have received `folder-video-setup.exe`, run it and follow the Windows installer. It creates Start menu and desktop shortcuts.
If the pinned Start menu tile shows a blank page after an update, unpin that tile and pin Folder-video again from the app list.

To build the installer from source, use the instructions in the [technical documentation](docs/README.md). The portable build is a folder at `out\\folder-video-win32-x64`; keep its files together and run `folder-video.exe` from that folder.

## Everyday use

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

## License

MIT.
