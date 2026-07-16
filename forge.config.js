module.exports = {
  packagerConfig: { asar: true, executableName: 'folder-video', icon: './assets/folder-video.ico', ignore: /thumbnail-queue\.test\.js$/ },
  rebuildConfig: {},
  makers: [
    { name: '@electron-forge/maker-squirrel', config: { name: 'folder_video', setupExe: 'folder-video-setup.exe', setupIcon: './assets/folder-video.ico', iconUrl: 'https://raw.githubusercontent.com/viktortat/karpaty-db-electron/main/demo-vik2/assets/folder-video.ico' } },
    { name: '@electron-forge/maker-zip', platforms: ['win32', 'darwin'] },
    { name: '@electron-forge/maker-dmg', platforms: ['darwin'] }
  ]
};
