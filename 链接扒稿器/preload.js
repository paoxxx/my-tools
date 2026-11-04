const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  enqueue: (jobs) => ipcRenderer.invoke('enqueue', jobs),
  history: () => ipcRenderer.invoke('history'),
  settings: () => ipcRenderer.invoke('get-settings'),
  readClipboard: () => ipcRenderer.invoke('read-clipboard'),
  copy: (t) => ipcRenderer.invoke('copy', t),
  readNote: (p) => ipcRenderer.invoke('read-note', p),
  openNote: (p) => ipcRenderer.invoke('open-note', p),
  reveal: (p) => ipcRenderer.invoke('reveal', p),
  chooseDir: () => ipcRenderer.invoke('choose-dir'),
  saveEngine: (o) => ipcRenderer.invoke('save-engine', o),
  openWordbook: () => ipcRenderer.invoke('open-wordbook'),
  login: (kind) => ipcRenderer.invoke('login', kind),
  testDoubao: () => ipcRenderer.invoke('test-doubao'),
  pathOf: (file) => webUtils.getPathForFile(file),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, msg) => cb(msg)),
});
