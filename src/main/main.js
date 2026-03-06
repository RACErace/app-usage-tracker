const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const { UsageTracker } = require('./tracker');

let mainWindow;
let usageTracker;
let tray;
let isQuitting = false;
let autoLaunchEnabled = false;
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

function getLoginItemOptions(enabled) {
  if (process.platform !== 'win32') {
    return { openAtLogin: enabled };
  }

  if (app.isPackaged) {
    return {
      openAtLogin: enabled,
      openAsHidden: true
    };
  }

  return {
    openAtLogin: enabled,
    openAsHidden: true,
    path: process.execPath,
    args: [app.getAppPath()]
  };
}

function readAutoLaunchState() {
  const settings = app.getLoginItemSettings(getLoginItemOptions(false));
  return Boolean(settings.openAtLogin);
}

function writeAutoLaunchState(enabled) {
  app.setLoginItemSettings(getLoginItemOptions(enabled));
  autoLaunchEnabled = readAutoLaunchState();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('settings:changed', {
      autoLaunchEnabled
    });
  }
  updateTrayMenu();
}

function resolveAppIconPath() {
  return path.join(app.getAppPath(), 'app.ico');
}

function createTrayIcon() {
  const iconPath = resolveAppIconPath();
  const icon = nativeImage.createFromPath(iconPath);
  if (!icon.isEmpty()) {
    return icon.resize({ width: 16, height: 16 });
  }

  const fallbackSvg = `
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="64" rx="18" fill="#111216"/>
      <rect x="12" y="38" width="8" height="14" rx="3" fill="#1A8DFF"/>
      <rect x="26" y="22" width="8" height="30" rx="3" fill="#1A8DFF"/>
      <rect x="40" y="12" width="8" height="40" rx="3" fill="#F08A9F"/>
    </svg>`;

  return nativeImage
    .createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(fallbackSvg).toString('base64')}`)
    .resize({ width: 16, height: 16 });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function hideMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
}

function updateTrayMenu() {
  if (!tray) {
    return;
  }

  const menu = Menu.buildFromTemplate([
    {
      label: mainWindow && mainWindow.isVisible() ? '隐藏主窗口' : '显示主窗口',
      click: () => {
        if (mainWindow && mainWindow.isVisible()) {
          hideMainWindow();
        } else {
          showMainWindow();
        }
      }
    },
    {
      label: '开机自启动',
      type: 'checkbox',
      checked: autoLaunchEnabled,
      click: (menuItem) => {
        writeAutoLaunchState(menuItem.checked);
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(menu);
}

function createTray() {
  if (tray) {
    return;
  }

  tray = new Tray(createTrayIcon());
  tray.setToolTip('使用统计');
  tray.on('click', () => {
    if (mainWindow && mainWindow.isVisible()) {
      hideMainWindow();
    } else {
      showMainWindow();
    }
  });
  tray.on('double-click', showMainWindow);
  updateTrayMenu();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 430,
    height: 920,
    minWidth: 410,
    minHeight: 840,
    backgroundColor: '#050507',
    autoHideMenuBar: true,
    title: '使用统计',
    icon: resolveAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('minimize', (event) => {
    event.preventDefault();
    hideMainWindow();
    updateTrayMenu();
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    hideMainWindow();
    updateTrayMenu();
  });

  mainWindow.on('show', updateTrayMenu);
  mainWindow.on('hide', updateTrayMenu);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function bootstrap() {
  autoLaunchEnabled = readAutoLaunchState();

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
  createTray();
  createWindow();
}

if (gotSingleInstanceLock) {
  app.on('second-instance', () => {
    showMainWindow();
  });

  app.whenReady().then(bootstrap).catch((error) => {
    console.error('应用启动失败:', error);
    app.quit();
  });
}

process.on('unhandledRejection', (error) => {
  console.error('未处理的 Promise 异常:', error);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    showMainWindow();
  }
});

app.on('before-quit', async () => {
  isQuitting = true;
  if (usageTracker) {
    await usageTracker.dispose();
  }
});

ipcMain.handle('settings:get', async () => ({
  autoLaunchEnabled
}));

ipcMain.handle('settings:set-auto-launch', async (_event, enabled) => {
  writeAutoLaunchState(Boolean(enabled));
  return {
    autoLaunchEnabled
  };
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