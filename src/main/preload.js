const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('usageApi', {
  getSnapshot: () => ipcRenderer.invoke('usage:get-snapshot'),
  getDetail: (itemKey) => ipcRenderer.invoke('usage:get-detail', itemKey),
  getIcons: (items) => ipcRenderer.invoke('usage:get-icons', items),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('settings:set-auto-launch', enabled),
  forcePoll: () => ipcRenderer.invoke('usage:force-poll'),
  onDataChanged: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('usage:data-changed', wrapped);
    return () => ipcRenderer.removeListener('usage:data-changed', wrapped);
  },
  onSettingsChanged: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('settings:changed', wrapped);
    return () => ipcRenderer.removeListener('settings:changed', wrapped);
  }
});