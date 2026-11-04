const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  read: () => ipcRenderer.invoke('clip:read'),
  write: (d) => ipcRenderer.invoke('clip:write', d),
  top: (on) => ipcRenderer.invoke('win:top', on),
  save: (t) => ipcRenderer.invoke('file:save', t)
});
