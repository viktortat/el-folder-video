module.exports = {
  packagerConfig: {
    asar: true,
    executableName: 'folder-video',
    icon: './assets/folder-video.ico',
    ignore: [
      /^\/\.bun-tmp(?:\/|$)/,
      /(thumbnail-queue|summary-core|notes-core|session-core|cut-core|cut-ffmpeg|cut-undo|move-file-conflict|video-metadata-store|waveform-core|author-url-property|update-core|update-ipc)\.test\.js$/
    ],
    extraResource: [
      'scripts/transcribe_handy.py',
      'tools/transcribe-cpp/transcribe-native-windows-x86_64-cpu-vulkan'
    ]
  },
  rebuildConfig: {},
  makers: [
    { name: '@electron-forge/maker-squirrel', config: { name: 'folder_video', setupExe: 'folder-video-setup.exe', setupIcon: './assets/folder-video.ico', iconUrl: 'https://raw.githubusercontent.com/viktortat/karpaty-db-electron/main/demo-vik2/assets/folder-video.ico' } },
    { name: '@electron-forge/maker-zip', platforms: ['win32', 'darwin'] },
    { name: '@electron-forge/maker-dmg', platforms: ['darwin'] }
  ]
};
