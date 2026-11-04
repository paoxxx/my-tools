const { contextBridge, ipcRenderer } = require('electron');
const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('api', {
  getSettings: inv('settings:get'),
  setSettings: inv('settings:set'),
  list: inv('rec:list'),
  get: inv('rec:get'),
  audioUrl: inv('rec:audioUrl'),
  audioBytes: inv('rec:audioBytes'),
  save: inv('rec:save'),
  transcribe: inv('rec:transcribe'),
  remove: inv('rec:remove'),
  copy: inv('copy'),
  share: inv('share'),
  exportFiles: inv('export'),
  pickExportDir: inv('pick:exportDir'),
  micAsk: inv('mic:ask'),
  openMicSettings: inv('mic:settings'),
  onProgress: (fn) => ipcRenderer.on('trans:progress', (e, d) => fn(d)),
});
