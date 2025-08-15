// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFile: (options) => ipcRenderer.invoke('dialog:openFile', options), 
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  openPath: (filePath) => ipcRenderer.invoke('shell:openPath', filePath),
  resolveAndOpenPath: (pathInfo) => ipcRenderer.invoke('shell:resolveAndOpenPath', pathInfo),

  getPythonServerUrl: () => `http://localhost:5001`,

  downloadModelFile: (options) => ipcRenderer.invoke('download-model-file', options),
  onModelDownloadProgress: (callback) => {
      const handler = (_event, value) => callback(value);
      ipcRenderer.on('download-model-progress', handler);
      return () => ipcRenderer.removeListener('download-model-progress', handler);
  },
  onModelDownloadComplete: (callback) => {
      const handler = (_event, value) => callback(value);
      ipcRenderer.on('download-model-complete', handler);
      return () => ipcRenderer.removeListener('download-model-complete', handler);
  },
  checkModelFileExists: (options) => ipcRenderer.invoke('check-model-file-exists', options),
  saveHdpcDialog: (options) => ipcRenderer.invoke('dialog:save-hdpc', options),
  onServerReady: (callback) => ipcRenderer.on('server-ready', callback),
  onSplashStatusUpdate: (callback) => ipcRenderer.on('splash-status-update', (_event, message) => callback(message)),
  setShowStartupDialog: (value) => ipcRenderer.send('set-show-startup-dialog', value),
  onShowStartupInfo: (callback) => ipcRenderer.on('show-startup-info', (_event, data) => callback(data))
});