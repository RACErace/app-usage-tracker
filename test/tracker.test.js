const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  BRIDGE_SHARED_HEADER_NAME,
  BRIDGE_SHARED_HEADER_VALUE,
  migrateUsageData,
  __testables
} = require('../src/main/tracker');

test('getDayKey uses local calendar date instead of UTC date', () => {
  const script = `
    const { __testables } = require('./src/main/tracker');
    const date = new Date(2026, 2, 8, 0, 30);
    process.stdout.write(JSON.stringify({
      dayKey: __testables.getDayKey(date),
      isoKey: date.toISOString().slice(0, 10)
    }));
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, TZ: 'Asia/Shanghai' },
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    dayKey: '2026-03-08',
    isoKey: '2026-03-07'
  });
});

test('getRootDomain respects private suffixes and country-code registrable domains', () => {
  assert.equal(__testables.getRootDomain('foo.github.io'), 'foo.github.io');
  assert.equal(__testables.getRootDomain('preview.my-app.vercel.app'), 'my-app.vercel.app');
  assert.equal(__testables.getRootDomain('docs.example.co.uk'), 'example.co.uk');
  assert.equal(__testables.getRootDomain('localhost'), 'localhost');
  assert.equal(__testables.getRootDomain('127.0.0.1'), '127.0.0.1');
});

test('bridge authorization only accepts extension origins with the shared header', () => {
  assert.equal(__testables.isAllowedBridgeOrigin('chrome-extension://abcdefghijklmnop'), true);
  assert.equal(__testables.isAllowedBridgeOrigin('moz-extension://example-id'), true);
  assert.equal(__testables.isAllowedBridgeOrigin('https://example.com'), false);

  assert.equal(
    __testables.isBridgeRequestAuthorized({
      origin: 'chrome-extension://abcdefghijklmnop',
      'content-type': 'application/json; charset=utf-8',
      [BRIDGE_SHARED_HEADER_NAME]: BRIDGE_SHARED_HEADER_VALUE
    }),
    true
  );

  assert.equal(
    __testables.isBridgeRequestAuthorized({
      origin: 'https://example.com',
      'content-type': 'application/json',
      [BRIDGE_SHARED_HEADER_NAME]: BRIDGE_SHARED_HEADER_VALUE
    }),
    false
  );
});

test('migration keeps private-suffix websites separated instead of collapsing them', () => {
  const migrated = migrateUsageData({
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
  });

  const [item] = Object.values(migrated.data.days['2026-03-08'].items);
  assert.equal(item.host, 'foo.github.io');
  assert.equal(item.label, 'foo');
});
