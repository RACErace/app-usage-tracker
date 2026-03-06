const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { UsageTracker } = require('./tracker');

let mainWindow;
let usageTracker;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 430,
    height: 920,
    minWidth: 410,
    minHeight: 840,
    backgroundColor: '#050507',
    autoHideMenuBar: true,
    title: '使用统计',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function bootstrap() {
  usageTracker = new UsageTracker({
    userDataPath: app.getPath('userData'),
    onDataChanged: async () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const snapshot = usageTracker.getSnapshot();
        mainWindow.webContents.send('usage:data-changed', snapshot);
      }
    }
  });

  await usageTracker.init();
  createWindow();
}

app.whenReady().then(bootstrap);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', async () => {
  if (usageTracker) {
    await usageTracker.dispose();
  }
});

ipcMain.handle('usage:get-snapshot', async () => {
  return usageTracker ? usageTracker.getSnapshot() : null;
});

ipcMain.handle('usage:get-detail', async (_event, itemKey) => {
  return usageTracker ? usageTracker.getItemDetail(itemKey) : null;
});

ipcMain.handle('usage:force-poll', async () => {
  if (!usageTracker) {
    return null;
  }

  await usageTracker.pollActiveWindow();
  return usageTracker.getSnapshot();
});