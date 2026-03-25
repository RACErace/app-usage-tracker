const { migrateUsageData } = require('./tracker');

const BACKUP_VERSION = 1;
const BACKUP_FILE_PREFIX = 'app-usage-tracker-backup';

function padNumber(value) {
  return String(value).padStart(2, '0');
}

function sanitizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isUsageDataLike(value) {
  return isObject(value) && (isObject(value.days) || Number.isFinite(Number(value.version)));
}

function formatBackupTimestamp(date = new Date()) {
  return [
    date.getFullYear(),
    padNumber(date.getMonth() + 1),
    padNumber(date.getDate())
  ].join('') + '-' + [
    padNumber(date.getHours()),
    padNumber(date.getMinutes()),
    padNumber(date.getSeconds())
  ].join('');
}

function getDefaultBackupFileName(date = new Date()) {
  return `${BACKUP_FILE_PREFIX}-${formatBackupTimestamp(date)}.json`;
}

function buildBackupPayload({ usageData, settings, appVersion, exportedAt = new Date().toISOString() }) {
  const migrated = migrateUsageData(usageData);
  return {
    backupVersion: BACKUP_VERSION,
    exportedAt,
    appVersion: sanitizeText(appVersion),
    usageData: cloneJson(migrated.data),
    settings: isObject(settings) ? cloneJson(settings) : {}
  };
}

function parseBackupPayload(rawValue) {
  if (!isObject(rawValue)) {
    throw new Error('备份文件格式无效。');
  }

  if (isUsageDataLike(rawValue)) {
    const migrated = migrateUsageData(rawValue);
    return {
      usageData: migrated.data,
      settings: null,
      meta: {
        source: 'usage-data',
        backupVersion: 0,
        exportedAt: '',
        appVersion: ''
      }
    };
  }

  if (!isUsageDataLike(rawValue.usageData)) {
    throw new Error('备份文件缺少 usageData 数据。');
  }

  const migrated = migrateUsageData(rawValue.usageData);
  return {
    usageData: migrated.data,
    settings: isObject(rawValue.settings) ? cloneJson(rawValue.settings) : null,
    meta: {
      source: 'backup',
      backupVersion: Number(rawValue.backupVersion) || 0,
      exportedAt: sanitizeText(rawValue.exportedAt),
      appVersion: sanitizeText(rawValue.appVersion)
    }
  };
}

module.exports = {
  BACKUP_VERSION,
  buildBackupPayload,
  parseBackupPayload,
  getDefaultBackupFileName
};
