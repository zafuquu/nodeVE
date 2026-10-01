const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clipForge', {
  // File dialogs
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  saveFile: () => ipcRenderer.invoke('dialog:saveFile'),

  // FFmpeg
  checkGpu: () => ipcRenderer.invoke('ffmpeg:checkGpu'),
  exportVideo: (config) => ipcRenderer.invoke('ffmpeg:export', config),
  cancelExport: () => ipcRenderer.invoke('ffmpeg:cancel'),
  probeVideo: (filepath) => ipcRenderer.invoke('ffmpeg:probe', filepath),
  getPresets: () => ipcRenderer.invoke('get-presets'),
  loadPreset: (filename) => ipcRenderer.invoke('load-preset', filename),

  // Export progress listener — clears stale listeners before adding
  onExportProgress: (callback) => {
    ipcRenderer.removeAllListeners('ffmpeg:progress');
    ipcRenderer.on('ffmpeg:progress', (_event, progress) => callback(progress));
  },
  removeExportProgress: () => {
    ipcRenderer.removeAllListeners('ffmpeg:progress');
  },
});
