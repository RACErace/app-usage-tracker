const fs = require('fs/promises');
const { app, BrowserWindow, dialog, ipcMain, Menu, Tray, nativeImage, powerMonitor } = require('electron');
const path = require('path');
const {
  cloneRuleList,
  getAvailableCategories,
  normalizeCategoryRules,
  normalizeCustomServiceRules
} = require('./customization');
const {
  DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES,
  normalizeAutoBackupIntervalMinutes,
  calculateNextAutoBackupAt
} = require('./auto-backup');
const { buildBackupPayload, parseBackupPayload, getDefaultBackupFileName } = require('./backup');
const { loadJsonFileWithRecovery, writeFileAtomic, writeJsonFileAtomic } = require('./json-storage');
const { UsageTracker } = require('./tracker');
const { UsageIconService } = require('./icon-service');

const LOGIN_HIDDEN_ARG = '--launch-hidden';
const SHOW_WINDOW_ARG = '--show-window';
const CLOSE_ACTION_EXIT = 'exit';
const CLOSE_ACTION_TRAY = 'tray';
const CLOSE_ACTION_ASK = 'ask';
const THEME_PREFERENCE_LIGHT = 'light';
const THEME_PREFERENCE_DARK = 'dark';
const THEME_PREFERENCE_SYSTEM = 'system';
const AUTO_BACKUP_DIR_NAME = 'backups';
const AUTO_BACKUP_MAX_TIMER_DELAY_MS = 2147483647;
const DEFAULT_IDLE_THRESHOLD_SECONDS = 5 * 60;
const MIN_IDLE_THRESHOLD_SECONDS = 60;
const MAX_IDLE_THRESHOLD_SECONDS = 12 * 60 * 60;
const BACKUP_FILE_FILTERS = [
  { name: 'JSON 文件', extensions: ['json'] }
];
const DEFAULT_APP_SETTINGS = Object.freeze({
  hiddenItemKeys: [],
  closeWindowAction: CLOSE_ACTION_TRAY,
  themePreference: THEME_PREFERENCE_SYSTEM,
  idleDetectionEnabled: true,
  idleThresholdSeconds: DEFAULT_IDLE_THRESHOLD_SECONDS,
  pauseOnLockScreen: true,
  autoBackupEnabled: false,
  autoBackupIntervalMinutes: DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES,
  lastAutoBackupAt: '',
  customServiceRules: [],
  categoryRules: []
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
let autoBackupTimer = null;
let autoBackupInFlight = null;
let lastAutoBackupError = '';
let appSettingsSaveChain = Promise.resolve();
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeCloseWindowAction(value) {
  if (value === CLOSE_ACTION_EXIT || value === CLOSE_ACTION_TRAY || value === CLOSE_ACTION_ASK) {
    return value;
  }

  return CLOSE_ACTION_TRAY;
}

function normalizeThemePreference(value) {
  if (value === THEME_PREFERENCE_LIGHT || value === THEME_PREFERENCE_DARK || value === THEME_PREFERENCE_SYSTEM) {
    return value;
  }

  return THEME_PREFERENCE_SYSTEM;
}

function normalizeIdleThresholdSeconds(value) {
  const numericValue = Math.round(Number(value) || DEFAULT_IDLE_THRESHOLD_SECONDS);
  return Math.min(Math.max(numericValue, MIN_IDLE_THRESHOLD_SECONDS), MAX_IDLE_THRESHOLD_SECONDS);
}

function normalizeImportedBackupSettings(value) {
  return {
    autoLaunchEnabled: Boolean(value?.autoLaunchEnabled),
    hiddenItemKeys: normalizeHiddenItemKeys(value?.hiddenItemKeys),
    closeWindowAction: normalizeCloseWindowAction(value?.closeWindowAction),
    themePreference: normalizeThemePreference(value?.themePreference),
    idleDetectionEnabled: value?.idleDetectionEnabled !== false,
    idleThresholdSeconds: normalizeIdleThresholdSeconds(value?.idleThresholdSeconds),
    pauseOnLockScreen: value?.pauseOnLockScreen !== false,
    autoBackupEnabled: Boolean(value?.autoBackupEnabled),
    autoBackupIntervalMinutes: normalizeAutoBackupIntervalMinutes(value?.autoBackupIntervalMinutes),
    lastAutoBackupAt: typeof value?.lastAutoBackupAt === 'string' ? value.lastAutoBackupAt.trim() : '',
    customServiceRules: normalizeCustomServiceRules(value?.customServiceRules),
    categoryRules: normalizeCategoryRules(value?.categoryRules)
  };
}

function getTrackerRuleSettings() {
  return {
    customServiceRules: cloneRuleList(appSettings.customServiceRules),
    categoryRules: cloneRuleList(appSettings.categoryRules)
  };
}

function getTrackerTrackingProtectionSettings() {
  return {
    idleDetectionEnabled: appSettings.idleDetectionEnabled !== false,
    idleThresholdSeconds: normalizeIdleThresholdSeconds(appSettings.idleThresholdSeconds),
    pauseOnLockScreen: appSettings.pauseOnLockScreen !== false
  };
}

function getAutoBackupDirectory() {
  return path.join(app.getPath('userData'), AUTO_BACKUP_DIR_NAME);
}

function getNextAutoBackupAt() {
  const nextTimestamp = calculateNextAutoBackupAt({
    enabled: appSettings.autoBackupEnabled,
    intervalMinutes: appSettings.autoBackupIntervalMinutes,
    lastAutoBackupAt: appSettings.lastAutoBackupAt
  });

  return nextTimestamp ? new Date(nextTimestamp).toISOString() : '';
}

function getStoredSettingsPayload() {
  return {
    autoLaunchEnabled,
    hiddenItemKeys: [...appSettings.hiddenItemKeys],
    closeWindowAction: appSettings.closeWindowAction,
    themePreference: normalizeThemePreference(appSettings.themePreference),
    idleDetectionEnabled: appSettings.idleDetectionEnabled !== false,
    idleThresholdSeconds: normalizeIdleThresholdSeconds(appSettings.idleThresholdSeconds),
    pauseOnLockScreen: appSettings.pauseOnLockScreen !== false,
    autoBackupEnabled: Boolean(appSettings.autoBackupEnabled),
    autoBackupIntervalMinutes: normalizeAutoBackupIntervalMinutes(appSettings.autoBackupIntervalMinutes),
    lastAutoBackupAt: typeof appSettings.lastAutoBackupAt === 'string' ? appSettings.lastAutoBackupAt : '',
    customServiceRules: cloneRuleList(appSettings.customServiceRules),
    categoryRules: cloneRuleList(appSettings.categoryRules)
  };
}

function getSettingsPayload() {
  return {
    ...getStoredSettingsPayload(),
    autoBackupDirectory: getAutoBackupDirectory(),
    nextAutoBackupAt: getNextAutoBackupAt(),
    lastAutoBackupError,
    availableCategories: getAvailableCategories()
  };
}

function formatIdleThresholdLabel(seconds) {
  const thresholdSeconds = normalizeIdleThresholdSeconds(seconds);
  const minutes = Math.round(thresholdSeconds / 60);

  if (minutes % 60 === 0) {
    return `${minutes / 60} 小时`;
  }

  return `${minutes} 分钟`;
}

function getTrackingStatusLabel(trackingState) {
  if (!trackingState?.foregroundPaused && !trackingState?.playbackPaused) {
    return '统计进行中';
  }

  const fullPauseReasons = [];
  if (trackingState?.manualPaused) {
    fullPauseReasons.push('手动暂停');
  }
  if (trackingState?.lockScreenPaused) {
    fullPauseReasons.push('锁屏暂停');
  }

  if (trackingState?.playbackPaused) {
    return fullPauseReasons.length
      ? `统计已暂停：${fullPauseReasons.join(' / ')}`
      : '统计已暂停';
  }

  if (trackingState?.idlePaused) {
    return `前台统计已暂停：空闲超过 ${formatIdleThresholdLabel(trackingState.idleThresholdSeconds)}`;
  }

  return '前台统计已暂停';
}

async function loadAppSettings() {
  const loaded = await loadJsonFileWithRecovery(getSettingsFilePath(), {
    validate: isPlainObject,
    defaultValue: () => ({})
  });
  const parsed = loaded.value;
  appSettings = {
    hiddenItemKeys: normalizeHiddenItemKeys(parsed?.hiddenItemKeys),
    closeWindowAction: normalizeCloseWindowAction(parsed?.closeWindowAction),
    themePreference: normalizeThemePreference(parsed?.themePreference),
    idleDetectionEnabled: parsed?.idleDetectionEnabled !== false,
    idleThresholdSeconds: normalizeIdleThresholdSeconds(parsed?.idleThresholdSeconds),
    pauseOnLockScreen: parsed?.pauseOnLockScreen !== false,
    autoBackupEnabled: Boolean(parsed?.autoBackupEnabled),
    autoBackupIntervalMinutes: normalizeAutoBackupIntervalMinutes(parsed?.autoBackupIntervalMinutes),
    lastAutoBackupAt: typeof parsed?.lastAutoBackupAt === 'string' ? parsed.lastAutoBackupAt.trim() : '',
    customServiceRules: normalizeCustomServiceRules(parsed?.customServiceRules),
    categoryRules: normalizeCategoryRules(parsed?.categoryRules)
  };

  if (loaded.recoveredFromBackup) {
    const recoveryDetail = loaded.corruptedPrimaryPath
      ? ` 已隔离损坏文件到 ${loaded.corruptedPrimaryPath}。`
      : '';
    console.error(`设置文件缺失或损坏，已从备份副本恢复。${recoveryDetail}`);
    if (loaded.restoreError) {
      console.error('恢复设置主文件失败，将在下次保存时重建主文件:', loaded.restoreError);
    }
  } else if (loaded.source === 'default' && loaded.primaryError && loaded.primaryError.code !== 'ENOENT') {
    const recoveryDetail = loaded.corruptedPrimaryPath
      ? ` 已将损坏文件隔离到 ${loaded.corruptedPrimaryPath}。`
      : '';
    console.error(`设置文件无法读取，已回退到默认设置。${recoveryDetail}`, loaded.primaryError);
    if (loaded.backupError && loaded.backupError.code !== 'ENOENT') {
      console.error('设置备份副本也无法恢复:', loaded.backupError);
    }
  }
}

async function saveAppSettings() {
  const serializedSnapshot = JSON.stringify({
    hiddenItemKeys: [...appSettings.hiddenItemKeys],
    closeWindowAction: appSettings.closeWindowAction,
    themePreference: normalizeThemePreference(appSettings.themePreference),
    idleDetectionEnabled: appSettings.idleDetectionEnabled !== false,
    idleThresholdSeconds: normalizeIdleThresholdSeconds(appSettings.idleThresholdSeconds),
    pauseOnLockScreen: appSettings.pauseOnLockScreen !== false,
    autoBackupEnabled: Boolean(appSettings.autoBackupEnabled),
    autoBackupIntervalMinutes: normalizeAutoBackupIntervalMinutes(appSettings.autoBackupIntervalMinutes),
    lastAutoBackupAt: typeof appSettings.lastAutoBackupAt === 'string' ? appSettings.lastAutoBackupAt : '',
    customServiceRules: cloneRuleList(appSettings.customServiceRules),
    categoryRules: cloneRuleList(appSettings.categoryRules)
  }, null, 2);

  appSettingsSaveChain = appSettingsSaveChain
    .catch(() => {})
    .then(async () => {
      const writeResult = await writeFileAtomic(getSettingsFilePath(), serializedSnapshot);
      if (writeResult.backupError) {
        console.error('设置已保存，但未能同步恢复副本:', writeResult.backupError);
      }
    });
  return appSettingsSaveChain;
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

async function writeThemePreference(themePreference) {
  appSettings.themePreference = normalizeThemePreference(themePreference);
  await saveAppSettings();
  notifySettingsChanged();
}

async function writeTrackingProtectionSettings({ idleDetectionEnabled, idleThresholdSeconds, pauseOnLockScreen }) {
  appSettings.idleDetectionEnabled = idleDetectionEnabled !== false;
  appSettings.idleThresholdSeconds = normalizeIdleThresholdSeconds(idleThresholdSeconds);
  appSettings.pauseOnLockScreen = pauseOnLockScreen !== false;
  await saveAppSettings();
  if (usageTracker) {
    await usageTracker.updateTrackingProtectionSettings(getTrackerTrackingProtectionSettings());
  }
  notifySettingsChanged();
}

async function writeCustomServiceRules(customServiceRules) {
  appSettings.customServiceRules = normalizeCustomServiceRules(customServiceRules);
  await saveAppSettings();
  if (usageTracker) {
    await usageTracker.updateRuleSettings(getTrackerRuleSettings());
  }
  notifySettingsChanged();
}

async function writeCategoryRules(categoryRules) {
  appSettings.categoryRules = normalizeCategoryRules(categoryRules);
  await saveAppSettings();
  if (usageTracker) {
    await usageTracker.updateRuleSettings(getTrackerRuleSettings());
  }
  notifySettingsChanged();
}

function clearAutoBackupTimer() {
  if (autoBackupTimer) {
    clearTimeout(autoBackupTimer);
    autoBackupTimer = null;
  }
}

async function writeBackupFile(targetFilePath) {
  if (!usageTracker) {
    throw new Error('使用统计尚未初始化完成。');
  }

  await usageTracker.flush();
  const exportedAt = new Date().toISOString();
  const backupPayload = buildBackupPayload({
    usageData: usageTracker.data,
    settings: getStoredSettingsPayload(),
    appVersion: app.getVersion(),
    exportedAt
  });

  await writeJsonFileAtomic(targetFilePath, backupPayload, { keepBackup: false });
  return {
    filePath: targetFilePath,
    exportedAt
  };
}

function scheduleAutoBackup() {
  clearAutoBackupTimer();

  if (!appSettings.autoBackupEnabled) {
    notifySettingsChanged();
    return;
  }

  const nextAutoBackupAt = calculateNextAutoBackupAt({
    enabled: true,
    intervalMinutes: appSettings.autoBackupIntervalMinutes,
    lastAutoBackupAt: appSettings.lastAutoBackupAt
  });
  const delayMs = Math.max(nextAutoBackupAt - Date.now(), 0);
  const timerDelayMs = Math.min(delayMs, AUTO_BACKUP_MAX_TIMER_DELAY_MS);

  autoBackupTimer = setTimeout(() => {
    const refreshedNextAutoBackupAt = calculateNextAutoBackupAt({
      enabled: true,
      intervalMinutes: appSettings.autoBackupIntervalMinutes,
      lastAutoBackupAt: appSettings.lastAutoBackupAt
    });

    if (refreshedNextAutoBackupAt > Date.now()) {
      scheduleAutoBackup();
      return;
    }

    runAutomaticBackup().catch((error) => {
      console.error('自动备份失败:', error);
    });
  }, timerDelayMs);

  notifySettingsChanged();
}

async function runAutomaticBackup() {
  if (!appSettings.autoBackupEnabled) {
    return null;
  }

  if (autoBackupInFlight) {
    return autoBackupInFlight;
  }

  const execute = (async () => {
    try {
      const targetFilePath = path.join(
        getAutoBackupDirectory(),
        getDefaultBackupFileName()
      );
      const result = await writeBackupFile(targetFilePath);
      appSettings.lastAutoBackupAt = result.exportedAt;
      lastAutoBackupError = '';
      await saveAppSettings();
      notifySettingsChanged();
      return result;
    } catch (error) {
      lastAutoBackupError = error instanceof Error ? error.message : String(error || '自动备份失败');
      notifySettingsChanged();
      throw error;
    } finally {
      autoBackupInFlight = null;
      scheduleAutoBackup();
    }
  })();

  autoBackupInFlight = execute;
  return execute;
}

async function writeAutoBackupSettings({ autoBackupEnabled, autoBackupIntervalMinutes }) {
  appSettings.autoBackupEnabled = Boolean(autoBackupEnabled);
  appSettings.autoBackupIntervalMinutes = normalizeAutoBackupIntervalMinutes(autoBackupIntervalMinutes);
  lastAutoBackupError = '';
  await saveAppSettings();
  scheduleAutoBackup();
}

function getBackupDialogBasePath() {
  const candidateKeys = ['documents', 'desktop', 'home'];
  for (const candidateKey of candidateKeys) {
    try {
      const value = app.getPath(candidateKey);
      if (value) {
        return value;
      }
    } catch {
      // Ignore missing platform paths and try the next candidate.
    }
  }

  return app.getPath('userData');
}

async function exportBackupFile() {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: '导出备份',
    defaultPath: path.join(getBackupDialogBasePath(), getDefaultBackupFileName()),
    filters: BACKUP_FILE_FILTERS
  });

  if (canceled || !filePath) {
    return { canceled: true };
  }

  const result = await writeBackupFile(filePath);
  return {
    canceled: false,
    filePath: result.filePath,
    exportedAt: result.exportedAt
  };
}

async function applyImportedBackupSettings(restoredSettings) {
  const normalized = normalizeImportedBackupSettings(restoredSettings);
  appSettings = {
    hiddenItemKeys: normalized.hiddenItemKeys,
    closeWindowAction: normalized.closeWindowAction,
    themePreference: normalized.themePreference,
    idleDetectionEnabled: normalized.idleDetectionEnabled,
    idleThresholdSeconds: normalized.idleThresholdSeconds,
    pauseOnLockScreen: normalized.pauseOnLockScreen,
    autoBackupEnabled: normalized.autoBackupEnabled,
    autoBackupIntervalMinutes: normalized.autoBackupIntervalMinutes,
    lastAutoBackupAt: normalized.lastAutoBackupAt,
    customServiceRules: normalized.customServiceRules,
    categoryRules: normalized.categoryRules
  };
  lastAutoBackupError = '';
  await saveAppSettings();
  writeAutoLaunchState(normalized.autoLaunchEnabled);
  if (usageTracker) {
    await usageTracker.updateRuleSettings(getTrackerRuleSettings());
    await usageTracker.updateTrackingProtectionSettings(getTrackerTrackingProtectionSettings());
  }
  scheduleAutoBackup();
  notifySettingsChanged();
}

function buildRestoreConfirmationDetail(parsedBackup) {
  if (parsedBackup.settings) {
    return '恢复会覆盖当前本地使用统计，并同步恢复开机自启动、关闭窗口行为和已隐藏统计项设置。';
  }

  return '恢复会覆盖当前本地使用统计；这个文件不包含应用设置，所以现有设置会保留。';
}

async function importBackupFile() {
  if (!usageTracker) {
    throw new Error('使用统计尚未初始化完成。');
  }

  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '导入备份',
    properties: ['openFile'],
    filters: BACKUP_FILE_FILTERS
  });

  if (canceled || !filePaths?.length) {
    return { canceled: true };
  }

  const filePath = filePaths[0];
  let parsed;

  try {
    parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    throw new Error('所选文件不是有效的 JSON 备份文件。');
  }

  const parsedBackup = parseBackupPayload(parsed);
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['继续恢复', '取消'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: '确认恢复备份',
    message: '恢复后当前本地数据将被替换。',
    detail: buildRestoreConfirmationDetail(parsedBackup)
  });

  if (response !== 0) {
    return { canceled: true };
  }

  await usageTracker.replaceData(parsedBackup.usageData);
  if (parsedBackup.settings) {
    await applyImportedBackupSettings(parsedBackup.settings);
  }

  await usageTracker.pollActiveWindow().catch(() => {});
  pushUsageSnapshot({ force: true });

  return {
    canceled: false,
    filePath,
    restoredAt: new Date().toISOString(),
    exportedAt: parsedBackup.meta.exportedAt,
    settingsRestored: Boolean(parsedBackup.settings)
  };
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
  clearAutoBackupTimer();

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

  const trackingState = usageTracker ? usageTracker.getTrackingState() : null;
  const trackingStatusLabel = getTrackingStatusLabel(trackingState);
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
      label: trackingStatusLabel,
      enabled: false
    },
    {
      label: '手动暂停统计',
      type: 'checkbox',
      checked: Boolean(trackingState?.manualPaused),
      click: (menuItem) => {
        if (!usageTracker) {
          return;
        }

        usageTracker.setManualPaused(menuItem.checked)
          .then(() => {
            updateTrayMenu();
          })
          .catch(() => {});
      }
    },
    { type: 'separator' },
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

  tray.setToolTip(
    trackingState?.playbackPaused
      ? '使用统计（已暂停）'
      : (trackingState?.foregroundPaused ? '使用统计（前台暂停）' : '使用统计')
  );
  tray.setContextMenu(menu);
}

function registerPowerMonitorEvents() {
  powerMonitor.on('lock-screen', () => {
    if (!usageTracker) {
      return;
    }

    usageTracker.setScreenLocked(true)
      .then(() => {
        updateTrayMenu();
      })
      .catch(() => {});
  });

  powerMonitor.on('unlock-screen', () => {
    if (!usageTracker) {
      return;
    }

    usageTracker.setScreenLocked(false)
      .then(() => {
        updateTrayMenu();
      })
      .catch(() => {});
  });
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
    ruleSettings: getTrackerRuleSettings(),
    trackingProtectionSettings: getTrackerTrackingProtectionSettings(),
    getSystemIdleTime: () => powerMonitor.getSystemIdleTime(),
    onDataChanged: async () => {
      updateTrayMenu();
      pushUsageSnapshot();
    }
  });

  await usageTracker.init();
  scheduleAutoBackup();
  registerPowerMonitorEvents();
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

ipcMain.handle('settings:set-theme-preference', async (_event, themePreference) => {
  await writeThemePreference(themePreference);
  return getSettingsPayload();
});

ipcMain.handle('settings:set-tracking-protection', async (_event, trackingProtectionSettings) => {
  await writeTrackingProtectionSettings(trackingProtectionSettings || {});
  return getSettingsPayload();
});

ipcMain.handle('settings:set-custom-service-rules', async (_event, customServiceRules) => {
  await writeCustomServiceRules(customServiceRules);
  return getSettingsPayload();
});

ipcMain.handle('settings:set-category-rules', async (_event, categoryRules) => {
  await writeCategoryRules(categoryRules);
  return getSettingsPayload();
});

ipcMain.handle('settings:set-auto-backup', async (_event, nextSettings) => {
  await writeAutoBackupSettings(nextSettings || {});
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

ipcMain.handle('tracking:set-manual-pause', async (_event, isPaused) => {
  if (!usageTracker) {
    return null;
  }

  await usageTracker.setManualPaused(Boolean(isPaused));
  updateTrayMenu();
  return usageTracker.getSnapshot();
});

ipcMain.handle('usage:get-icons', async (_event, items) => {
  if (!usageIconService) {
    return {};
  }

  return usageIconService.resolveItems(Array.isArray(items) ? items : []);
});

ipcMain.handle('backup:export', async () => exportBackupFile());

ipcMain.handle('backup:import', async () => importBackupFile());
