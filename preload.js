const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('uc', {
  call: (ch, ...a) => ipcRenderer.invoke(ch, ...a).then(r => { if (!r.ok) throw new Error(r.error); return r.data; }),
  send: (ch, ...a) => ipcRenderer.send(ch, ...a),
  on: (fn) => ipcRenderer.on('ev', (_e, d) => fn(d)),
  pathFor: (file) => webUtils.getPathForFile(file),
});
