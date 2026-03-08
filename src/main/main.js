const fs = require('fs/promises');
const { app, BrowserWindow, dialog, ipcMain, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const { UsageTracker } = require('./tracker');
const { UsageIconService } = require('./icon-service');

const LOGIN_HIDDEN_ARG = '--launch-hidden';
const SHOW_WINDOW_ARG = '--show-window';
const CLOSE_ACTION_EXIT = 'exit';
const CLOSE_ACTION_TRAY = 'tray';
const CLOSE_ACTION_ASK = 'ask';
const DEFAULT_APP_SETTINGS = Object.freeze({
  hiddenItemKeys: [],
  closeWindowAction: CLOSE_ACTION_TRAY
});

let mainWindow;
let usageTracker;
let tray;
let isQuitting = false;
let autoLaunchEnabled = false;
let usageIconService;
let shouldLaunchHidden = false;
let appSettings = { ...DEFAULT_APP_SETTINGS };
let isHandlingCloseAction = false;
let isShuttingDown = false;
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

function getLoginItemOptions(enabled) {
  if (process.platform === 'darwin') {
    return {
      openAtLogin: enabled,
      openAsHidden: true
    };
  }

  if (process.platform !== 'win32') {
    return { openAtLogin: enabled };
  }

  const options = {
    openAtLogin: enabled,
    path: process.execPath,
    args: app.isPackaged ? [LOGIN_HIDDEN_ARG] : [app.getAppPath(), LOGIN_HIDDEN_ARG]
  };

  return options;
}

function isHiddenLaunch() {
  return process.argv.includes(LOGIN_HIDDEN_ARG) && !process.argv.includes(SHOW_WINDOW_ARG);
}

function readAutoLaunchState() {
  const settings = app.getLoginItemSettings(getLoginItemOptions(false));
  return Boolean(settings.openAtLogin);
}

function getSettingsFilePath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function normalizeHiddenItemKeys(hiddenItemKeys) {
  if (!Array.isArray(hiddenItemKeys)) {
    return [];
  }

  return [...new Set(hiddenItemKeys.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function normalizeCloseWindowAction(value) {
  if (value === CLOSE_ACTION_EXIT || value === CLOSE_ACTION_TRAY || value === CLOSE_ACTION_ASK) {
    return value;
  }

  return CLOSE_ACTION_TRAY;
}

function getSettingsPayload() {
  return {
    autoLaunchEnabled,
    hiddenItemKeys: [...appSettings.hiddenItemKeys],
    closeWindowAction: appSettings.closeWindowAction
  };
}

async function loadAppSettings() {
  try {
    const rawSettings = await fs.readFile(getSettingsFilePath(), 'utf8');
    const parsed = JSON.parse(rawSettings);
    appSettings = {
      hiddenItemKeys: normalizeHiddenItemKeys(parsed?.hiddenItemKeys),
      closeWindowAction: normalizeCloseWindowAction(parsed?.closeWindowAction)
    };
  } catch {
    appSettings = { ...DEFAULT_APP_SETTINGS };
  }
}

async function saveAppSettings() {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(getSettingsFilePath(), JSON.stringify(appSettings, null, 2), 'utf8');
}

function notifySettingsChanged() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('settings:changed', getSettingsPayload());
  }
}

function writeAutoLaunchState(enabled) {
  app.setLoginItemSettings(getLoginItemOptions(enabled));
  autoLaunchEnabled = readAutoLaunchState();
  notifySettingsChanged();
  updateTrayMenu();
}

async function writeHiddenItemKeys(hiddenItemKeys) {
  appSettings.hiddenItemKeys = normalizeHiddenItemKeys(hiddenItemKeys);
  await saveAppSettings();
  notifySettingsChanged();
}

async function writeCloseWindowAction(closeWindowAction) {
  appSettings.closeWindowAction = normalizeCloseWindowAction(closeWindowAction);
  await saveAppSettings();
  notifySettingsChanged();
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

function pushUsageSnapshot({ force = false } = {}) {
  if (!usageTracker || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (!force && !mainWindow.isVisible()) {
    return;
  }

  const snapshot = usageTracker.getSnapshot();
  mainWindow.webContents.send('usage:data-changed', snapshot);
}

function hideMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
}

async function shutdownApp({ relaunch = false } = {}) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  isQuitting = true;

  try {
    if (usageTracker) {
      await usageTracker.dispose();
      usageTracker = null;
    }

    if (relaunch) {
      app.relaunch();
    }

    app.exit(0);
  } catch (error) {
    console.error('退出前保存使用数据失败:', error);

    if (relaunch) {
      app.relaunch();
    }

    app.exit(1);
  }
}

async function handleCloseRequest() {
  const action = normalizeCloseWindowAction(appSettings.closeWindowAction);
  if (action === CLOSE_ACTION_EXIT) {
    await shutdownApp();
    return;
  }

  if (action === CLOSE_ACTION_TRAY) {
    hideMainWindow();
    updateTrayMenu();
    return;
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['退出应用', '最小化到系统托盘', '取消'],
    defaultId: 1,
    cancelId: 2,
    noLink: true,
    title: '关闭窗口',
    message: '关闭窗口时要执行什么操作？',
    detail: '你可以在设置中修改默认关闭行为。'
  });

  if (response === 0) {
    await shutdownApp();
    return;
  }

  if (response === 1) {
    hideMainWindow();
    updateTrayMenu();
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
    {
      label: '重启',
      click: () => {
        shutdownApp({ relaunch: true }).catch(() => {});
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        shutdownApp().catch(() => {});
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
    width: 1120,
    height: 860,
    minWidth: 520,
    minHeight: 680,
    show: !shouldLaunchHidden,
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
    if (isHandlingCloseAction) {
      return;
    }

    isHandlingCloseAction = true;
    handleCloseRequest()
      .catch(() => {})
      .finally(() => {
        isHandlingCloseAction = false;
      });
  });

  mainWindow.on('show', () => {
    updateTrayMenu();
    pushUsageSnapshot({ force: true });
  });
  mainWindow.on('hide', updateTrayMenu);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  updateTrayMenu();
}

async function bootstrap() {
  shouldLaunchHidden = isHiddenLaunch();
  autoLaunchEnabled = readAutoLaunchState();
  await loadAppSettings();
  if (autoLaunchEnabled) {
    app.setLoginItemSettings(getLoginItemOptions(true));
  }
  usageIconService = new UsageIconService();

  usageTracker = new UsageTracker({
    userDataPath: app.getPath('userData'),
    onDataChanged: async () => {
      pushUsageSnapshot();
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
    app.exit(0);
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    showMainWindow();
  }
});

app.on('before-quit', (event) => {
  if (isShuttingDown || isQuitting) {
    return;
  }

  event.preventDefault();
  shutdownApp().catch(() => {});
});

ipcMain.handle('settings:get', async () => getSettingsPayload());

ipcMain.handle('settings:set-auto-launch', async (_event, enabled) => {
  writeAutoLaunchState(Boolean(enabled));
  return getSettingsPayload();
});

ipcMain.handle('settings:set-hidden-item-keys', async (_event, hiddenItemKeys) => {
  await writeHiddenItemKeys(hiddenItemKeys);
  return getSettingsPayload();
});

ipcMain.handle('settings:set-close-window-action', async (_event, closeWindowAction) => {
  await writeCloseWindowAction(closeWindowAction);
  return getSettingsPayload();
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

ipcMain.handle('usage:get-icons', async (_event, items) => {
  if (!usageIconService) {
    return {};
  }

  return usageIconService.resolveItems(Array.isArray(items) ? items : []);
});
