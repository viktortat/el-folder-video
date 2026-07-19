# Folder-video

[Русская версия](README.ru.md)

Folder-video is a local desktop app for finding the right moment in a video folder. It shows each file as a strip of frames, then opens the selected video in its own tab with a detailed frame grid.

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
- Scans supported video files, including subfolders when requested, and lets you filter, sort, and page through the results.
- Opens several videos in tabs. Each tab has standard playback controls, selectable playback speeds, and a frame grid for seeking by click or drag.
- Keeps up to ten recent folders and a separate list of favourite videos across launches.
- Stores a title, YouTube link, Obsidian link, Markdown notes, and tags in JSON files keyed by the video's SHA-256 content hash. The metadata stays with the same file after it is moved.
- Can save the current frame, copy the filename without its extension, reveal the file, open it in the system player, move it, or send it to the Windows Recycle Bin after confirmation.
- Creates a two-times-speed copy with FFmpeg when `ffmpeg` is available on `PATH`.

## Install and start

If you have received `folder-video-setup.exe`, run it and follow the Windows installer. It creates Start menu and desktop shortcuts.

To build the installer from source, use the instructions in the [technical documentation](docs/README.md). The portable build is a folder at `out\\folder-video-win32-x64`; keep its files together and run `folder-video.exe` from that folder.

## Everyday use

1. Choose a folder or drop one into the window.
2. Use the frame strips, filter, and sort controls to find a video.
3. Open a video row. Adjust the number of frame-grid columns, the time interval, and automatic scrolling if needed.
4. Click or drag across the grid to seek. The arrow keys, Home, End, and Space also control the player.
5. Add notes and tags in the metadata panel, then save them.

## Supported files and limits

Folder-video scans `mp4`, `webm`, `mov`, `avi`, `mkv`, `m4v`, and `ogv` files. Whether a file plays also depends on its codec support in Chromium.

The full feature set targets Windows 10 and Windows 11. Windows Explorer integration, Recycle Bin deletion, preserved timestamps on accelerated copies, and file moves are Windows features. The app works with local files and does not upload video content. FFmpeg is required only for making an accelerated copy.

[Technical documentation](docs/README.md)

## License

MIT.
