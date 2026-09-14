const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('controlEscritorio', {
  conectar: (servidor) => ipcRenderer.invoke('conectar', servidor),
  config: () => ipcRenderer.invoke('config'),
  version: process.versions.electron,
});
