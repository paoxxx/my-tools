const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listProjects: () => ipcRenderer.invoke('proj-list'),
  projectExists: (name) => ipcRenderer.invoke('proj-exists', name),
  saveProject: (name, json, files) => ipcRenderer.invoke('proj-save', name, json, files),
  loadProject: (name) => ipcRenderer.invoke('proj-load', name),
  renameProject: (a, b) => ipcRenderer.invoke('proj-rename', a, b),
  revealProject: (name) => ipcRenderer.invoke('proj-reveal', name),
  exportAudio: (opts) => ipcRenderer.invoke('export-audio', opts),
  onMenu: (fn) => ipcRenderer.on('menu', (e, cmd) => fn(cmd)),
  onCodeUpdated: (fn) => ipcRenderer.on('code-updated', () => fn()),
  onNeedRestart: (fn) => ipcRenderer.on('need-restart', () => fn()),
});
