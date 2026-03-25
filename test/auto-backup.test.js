const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES,
  MIN_AUTO_BACKUP_INTERVAL_MINUTES,
  MAX_AUTO_BACKUP_INTERVAL_MINUTES,
  normalizeAutoBackupIntervalMinutes,
  calculateNextAutoBackupAt
} = require('../src/main/auto-backup');

test('normalizeAutoBackupIntervalMinutes falls back and clamps to safe bounds', () => {
  assert.equal(normalizeAutoBackupIntervalMinutes(undefined), DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES);
  assert.equal(normalizeAutoBackupIntervalMinutes(15), MIN_AUTO_BACKUP_INTERVAL_MINUTES);
  assert.equal(
    normalizeAutoBackupIntervalMinutes(MAX_AUTO_BACKUP_INTERVAL_MINUTES + 60),
    MAX_AUTO_BACKUP_INTERVAL_MINUTES
  );
  assert.equal(normalizeAutoBackupIntervalMinutes(12 * 60), 12 * 60);
});

test('calculateNextAutoBackupAt returns 0 when auto backup is disabled', () => {
  assert.equal(calculateNextAutoBackupAt({
    enabled: false,
    intervalMinutes: 60,
    lastAutoBackupAt: '',
    now: 1000
  }), 0);
});

test('calculateNextAutoBackupAt runs immediately when there is no previous auto backup', () => {
  assert.equal(calculateNextAutoBackupAt({
    enabled: true,
    intervalMinutes: 24 * 60,
    lastAutoBackupAt: '',
    now: 5000
  }), 5000);
});

test('calculateNextAutoBackupAt respects the configured interval when a recent backup exists', () => {
  const lastAutoBackupAt = '2026-03-25T10:00:00.000Z';
  const now = Date.parse('2026-03-25T12:00:00.000Z');

  assert.equal(calculateNextAutoBackupAt({
    enabled: true,
    intervalMinutes: 6 * 60,
    lastAutoBackupAt,
    now
  }), Date.parse('2026-03-25T16:00:00.000Z'));
});

test('calculateNextAutoBackupAt triggers immediately when the scheduled time is overdue', () => {
  const now = Date.parse('2026-03-25T20:00:00.000Z');

  assert.equal(calculateNextAutoBackupAt({
    enabled: true,
    intervalMinutes: 60,
    lastAutoBackupAt: '2026-03-25T10:00:00.000Z',
    now
  }), now);
});
