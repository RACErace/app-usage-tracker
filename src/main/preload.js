const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('usageApi', {
  getSnapshot: () => ipcRenderer.invoke('usage:get-snapshot'),
  getDetail: (itemKey) => ipcRenderer.invoke('usage:get-detail', itemKey),
  forcePoll: () => ipcRenderer.invoke('usage:force-poll'),
  onDataChanged: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('usage:data-changed', wrapped);
    return () => ipcRenderer.removeListener('usage:data-changed', wrapped);
  }
});