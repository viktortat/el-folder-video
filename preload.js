const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('folderVideo', {
  chooseFolder: () => ipcRenderer.invoke('folder-video:choose-folder'),
  scan: (folderPath, recursive) => ipcRenderer.invoke('folder-video:scan', folderPath, recursive),
  readVideo: filePath => ipcRenderer.invoke('folder-video:read-video', filePath),
  getParentFolder: filePath => ipcRenderer.invoke('folder-video:parent-folder', filePath),
  loadMetadata: (requestId, filePath) => ipcRenderer.invoke('folder-video:metadata-load', requestId, filePath),
  cancelMetadata: requestId => ipcRenderer.invoke('folder-video:metadata-cancel', requestId),
  saveMetadata: metadata => ipcRenderer.invoke('folder-video:metadata-save', metadata),
  getMetadataTemplate: () => ipcRenderer.invoke('folder-video:metadata-template'),
  renderMarkdown: markdown => ipcRenderer.invoke('folder-video:render-markdown', markdown),
  openMetadataLink: url => ipcRenderer.invoke('folder-video:open-metadata-link', url),
  openProjectFolder: folderPath => ipcRenderer.invoke('folder-video:open-project-folder', folderPath),
  syncMetadata: () => ipcRenderer.invoke('folder-video:sync-metadata'),
  getPathForFile: file => webUtils.getPathForFile(file),
  showInFolder: filePath => ipcRenderer.invoke('folder-video:show-in-folder', filePath),
  openInSystemPlayer: filePath => ipcRenderer.invoke('folder-video:open-in-system-player', filePath),
  setTitle: folderPath => ipcRenderer.invoke('folder-video:set-title', folderPath),
  copyPath: filePath => ipcRenderer.invoke('folder-video:copy-path', filePath),
  copyImage: imageData => ipcRenderer.invoke('folder-video:copy-image', imageData),
  deleteFile: filePath => ipcRenderer.invoke('folder-video:delete-file', filePath),
  moveFile: filePath => ipcRenderer.invoke('folder-video:move-file', filePath),
  speedUp: (filePath, operationId, durationSeconds) => ipcRenderer.invoke('folder-video:speed-up', filePath, operationId, durationSeconds),
  onSpeedUpProgress: callback => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('folder-video:speed-up-progress', listener);
    return () => ipcRenderer.removeListener('folder-video:speed-up-progress', listener);
  },
  getAppInfo: () => ipcRenderer.invoke('folder-video:get-app-info'),
  getSettings: () => ipcRenderer.invoke('folder-video:get-settings'),
  getDefaultSettings: () => ipcRenderer.invoke('folder-video:get-default-settings'),
  saveSettings: settings => ipcRenderer.invoke('folder-video:save-settings', settings),
  confirmCloseSettings: () => ipcRenderer.invoke('folder-video:confirm-close-settings'),
  onOpenTarget: callback => ipcRenderer.on('folder-video:open-target', (_event, target) => callback(target))
});
