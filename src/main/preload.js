const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('usageApi', {
  getSnapshot: () => ipcRenderer.invoke('usage:get-snapshot'),
  getDetail: (itemKey) => ipcRenderer.invoke('usage:get-detail', itemKey),
  getIcons: (items) => ipcRenderer.invoke('usage:get-icons', items),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  exportBackup: () => ipcRenderer.invoke('backup:export'),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('settings:set-auto-launch', enabled),
  setAutoBackupSettings: (settings) => ipcRenderer.invoke('settings:set-auto-backup', settings),
  setCloseWindowAction: (closeWindowAction) => ipcRenderer.invoke('settings:set-close-window-action', closeWindowAction),
  setThemePreference: (themePreference) => ipcRenderer.invoke('settings:set-theme-preference', themePreference),
  setTrackingProtectionSettings: (settings) => ipcRenderer.invoke('settings:set-tracking-protection', settings),
  setCustomServiceRules: (customServiceRules) => ipcRenderer.invoke('settings:set-custom-service-rules', customServiceRules),
  setCategoryRules: (categoryRules) => ipcRenderer.invoke('settings:set-category-rules', categoryRules),
  setHiddenItemKeys: (hiddenItemKeys) => ipcRenderer.invoke('settings:set-hidden-item-keys', hiddenItemKeys),
  setManualPause: (isPaused) => ipcRenderer.invoke('tracking:set-manual-pause', isPaused),
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
