const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BACKUP_VERSION,
  buildBackupPayload,
  parseBackupPayload,
  getDefaultBackupFileName
} = require('../src/main/backup');

test('buildBackupPayload wraps usage data and settings into a versioned backup file', () => {
  const payload = buildBackupPayload({
    usageData: {
      version: 3,
      days: {}
    },
    settings: {
      autoLaunchEnabled: true,
      hiddenItemKeys: ['music:qqmusic'],
      closeWindowAction: 'tray'
    },
    appVersion: '1.4.0',
    exportedAt: '2026-03-25T06:30:00.000Z'
  });

  assert.equal(payload.backupVersion, BACKUP_VERSION);
  assert.equal(payload.appVersion, '1.4.0');
  assert.equal(payload.exportedAt, '2026-03-25T06:30:00.000Z');
  assert.deepEqual(payload.settings, {
    autoLaunchEnabled: true,
    hiddenItemKeys: ['music:qqmusic'],
    closeWindowAction: 'tray'
  });
  assert.deepEqual(payload.usageData, {
    version: 3,
    days: {}
  });
});

test('parseBackupPayload accepts wrapped backup files and migrates usage data', () => {
  const parsed = parseBackupPayload({
    backupVersion: 1,
    exportedAt: '2026-03-20T12:00:00.000Z',
    appVersion: '1.2.0',
    usageData: {
      version: 2,
      days: {
        '2026-03-08': {
          totalMs: 60000,
          items: {
            legacy: {
              key: 'legacy',
              kind: 'site',
              label: 'foo',
              subtitle: 'Foo Page',
              appName: 'Chrome',
              browserFamily: 'Chrome',
              pageTitle: 'Foo Page',
              windowTitle: 'Foo Page',
              url: 'https://foo.github.io/page',
              host: 'foo.github.io',
              path: '/page',
              executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
              totalMs: 60000,
              hourly: new Array(24).fill(0),
              color: '#1c8cff',
              lastSeenAt: 1
            }
          }
        }
      }
    },
    settings: {
      autoLaunchEnabled: false,
      hiddenItemKeys: ['site:abc'],
      closeWindowAction: 'ask'
    }
  });

  const [item] = Object.values(parsed.usageData.days['2026-03-08'].items);
  assert.equal(parsed.meta.source, 'backup');
  assert.equal(parsed.meta.backupVersion, 1);
  assert.equal(parsed.meta.exportedAt, '2026-03-20T12:00:00.000Z');
  assert.equal(parsed.meta.appVersion, '1.2.0');
  assert.equal(parsed.usageData.version, 3);
  assert.equal(item.host, 'foo.github.io');
  assert.equal(item.label, 'foo');
  assert.deepEqual(parsed.settings, {
    autoLaunchEnabled: false,
    hiddenItemKeys: ['site:abc'],
    closeWindowAction: 'ask'
  });
});

test('parseBackupPayload accepts raw usage-data files without settings', () => {
  const parsed = parseBackupPayload({
    version: 3,
    days: {
      '2026-03-25': {
        totalMs: 120000,
        items: {
          'app:notepad': {
            key: 'app:notepad',
            kind: 'app',
            label: 'Notepad',
            subtitle: 'Untitled - Notepad',
            appName: 'Notepad',
            browserFamily: null,
            pageTitle: '',
            windowTitle: 'Untitled - Notepad',
            url: '',
            host: '',
            path: '',
            executablePath: 'C:\\Windows\\notepad.exe',
            totalMs: 120000,
            hourly: new Array(24).fill(0),
            color: '#1c8cff',
            lastSeenAt: 1
          }
        }
      }
    }
  });

  assert.equal(parsed.meta.source, 'usage-data');
  assert.equal(parsed.settings, null);
  assert.equal(parsed.usageData.version, 3);
  assert.equal(parsed.usageData.days['2026-03-25'].totalMs, 120000);
  assert.equal(parsed.usageData.days['2026-03-25'].items['app:notepad'].label, 'Notepad');
});

test('parseBackupPayload rejects invalid backup objects', () => {
  assert.throws(() => parseBackupPayload(null), /备份文件格式无效/);
  assert.throws(() => parseBackupPayload({ backupVersion: 1, settings: {} }), /缺少 usageData/);
});

test('getDefaultBackupFileName uses a sortable local timestamp', () => {
  const fileName = getDefaultBackupFileName(new Date(2026, 2, 25, 14, 5, 9));
  assert.equal(fileName, 'app-usage-tracker-backup-20260325-140509.json');
});
