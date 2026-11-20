const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tm', {
  onSnapshot: cb => ipcRenderer.on('snapshot', (_e, s) => cb(s)),
  onHistory: cb => ipcRenderer.on('history', (_e, h) => cb(h)),
  onWinState: cb => ipcRenderer.on('winstate', (_e, s) => cb(s)),
  win: cmd => ipcRenderer.send('win', cmd),
  refresh: () => ipcRenderer.send('refresh'),
  mini: (cmd, arg) => ipcRenderer.send('mini', cmd, arg),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  sessionDetails: sid => ipcRenderer.invoke('session:details', sid),
  exportUsage: (range, format) => ipcRenderer.invoke('history:export', range, format),
  setSetting: (name, value) => ipcRenderer.send('settings:set', name, value),
  onSettings: cb => ipcRenderer.on('settings', (_e, s) => cb(s)),
  onGoto: cb => ipcRenderer.on('goto', (_e, view) => cb(view)),
  testNotification: () => ipcRenderer.send('settings:test-notification'),
  openDataFolder: () => ipcRenderer.send('settings:open-data'),
  copyDiagnostics: () => ipcRenderer.invoke('settings:diagnostics'),
  checkUpdate: () => ipcRenderer.send('update:check'),
  installUpdate: () => ipcRenderer.send('update:install'),
  cancelUpdate: () => ipcRenderer.send('update:cancel'),
  openReleasePage: () => ipcRenderer.send('update:page')
});
