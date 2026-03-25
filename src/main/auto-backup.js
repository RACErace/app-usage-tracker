const DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES = 24 * 60;
const MIN_AUTO_BACKUP_INTERVAL_MINUTES = 60;
const MAX_AUTO_BACKUP_INTERVAL_MINUTES = 365 * 24 * 60;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function parseTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string' || !value.trim()) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeAutoBackupIntervalMinutes(value) {
  const numericValue = Math.round(Number(value));
  if (!Number.isFinite(numericValue)) {
    return DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES;
  }

  return clamp(
    numericValue,
    MIN_AUTO_BACKUP_INTERVAL_MINUTES,
    MAX_AUTO_BACKUP_INTERVAL_MINUTES
  );
}

function calculateNextAutoBackupAt({
  enabled,
  intervalMinutes,
  lastAutoBackupAt,
  now = Date.now()
}) {
  if (!enabled) {
    return 0;
  }

  const normalizedIntervalMinutes = normalizeAutoBackupIntervalMinutes(intervalMinutes);
  const intervalMs = normalizedIntervalMinutes * 60 * 1000;
  const lastBackupTimestamp = parseTimestamp(lastAutoBackupAt);

  if (!lastBackupTimestamp) {
    return now;
  }

  return Math.max(lastBackupTimestamp + intervalMs, now);
}

module.exports = {
  DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES,
  MIN_AUTO_BACKUP_INTERVAL_MINUTES,
  MAX_AUTO_BACKUP_INTERVAL_MINUTES,
  normalizeAutoBackupIntervalMinutes,
  calculateNextAutoBackupAt
};
