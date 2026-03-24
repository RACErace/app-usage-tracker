const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const cliPath = path.join(repoRoot, 'src', 'cli', 'query.js');

function createHourly(hour, durationMs) {
  const hourly = new Array(24).fill(0);
  hourly[hour] = durationMs;
  return hourly;
}

function createItem({
  key,
  kind,
  label,
  subtitle,
  appName,
  host = '',
  url = '',
  pageTitle = '',
  executablePath = '',
  totalMs,
  hourly,
  lastSeenAt
}) {
  return {
    key,
    kind,
    label,
    subtitle,
    appName,
    browserFamily: null,
    pageTitle,
    windowTitle: subtitle,
    url,
    host,
    path: '',
    executablePath,
    totalMs,
    hourly,
    color: '#1c8cff',
    lastSeenAt
  };
}

async function createFixtureDataFile({ hiddenItemKeys = [] } = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'app-usage-tracker-cli-'));
  const dataFilePath = path.join(tempDir, 'usage-data.json');
  const chatgptDayOne = createItem({
    key: 'service:chatgpt',
    kind: 'service',
    label: 'ChatGPT',
    subtitle: 'Daily AI work',
    appName: 'ChatGPT',
    host: 'chatgpt.com',
    url: 'https://chatgpt.com/',
    pageTitle: 'ChatGPT',
    totalMs: 3600000,
    hourly: createHourly(9, 3600000),
    lastSeenAt: 1
  });
  const githubDayOne = createItem({
    key: 'site:github',
    kind: 'site',
    label: 'github',
    subtitle: 'Repository review',
    appName: 'Chrome',
    host: 'github.com',
    url: 'https://github.com/openai',
    pageTitle: 'openai',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    totalMs: 1800000,
    hourly: createHourly(10, 1800000),
    lastSeenAt: 2
  });
  const chatgptDayTwo = createItem({
    key: 'service:chatgpt',
    kind: 'service',
    label: 'ChatGPT',
    subtitle: 'Prompting session',
    appName: 'ChatGPT',
    host: 'chatgpt.com',
    url: 'https://chatgpt.com/',
    pageTitle: 'ChatGPT',
    totalMs: 5400000,
    hourly: createHourly(11, 5400000),
    lastSeenAt: 3
  });
  const vscodeDayTwo = createItem({
    key: 'app:vscode:abc123',
    kind: 'app',
    label: 'Visual Studio Code',
    subtitle: 'src/cli/query.js',
    appName: 'Visual Studio Code',
    executablePath: 'C:\\Users\\race2\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
    totalMs: 1800000,
    hourly: createHourly(15, 1800000),
    lastSeenAt: 4
  });

  await fs.writeFile(dataFilePath, JSON.stringify({
    version: 3,
    days: {
      '2026-03-23': {
        totalMs: chatgptDayOne.totalMs + githubDayOne.totalMs,
        items: {
          [chatgptDayOne.key]: chatgptDayOne,
          [githubDayOne.key]: githubDayOne
        }
      },
      '2026-03-24': {
        totalMs: chatgptDayTwo.totalMs + vscodeDayTwo.totalMs,
        items: {
          [chatgptDayTwo.key]: chatgptDayTwo,
          [vscodeDayTwo.key]: vscodeDayTwo
        }
      }
    }
  }, null, 2), 'utf8');
  await fs.writeFile(path.join(tempDir, 'settings.json'), JSON.stringify({
    hiddenItemKeys
  }, null, 2), 'utf8');

  return {
    dataFilePath,
    cleanup: () => fs.rm(tempDir, { recursive: true, force: true })
  };
}

function runCli(args, env = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8'
  });
}

test('top command returns the latest day ranking in json', async () => {
  const fixture = await createFixtureDataFile();

  try {
    const result = runCli(['top', '--range', 'day', '--day', '2026-03-24', '--limit', '2', '--format', 'json', '--data-file', fixture.dataFilePath]);
    assert.equal(result.status, 0, result.stderr);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.kind, 'top');
    assert.equal(payload.range, 'day');
    assert.equal(payload.dayKey, '2026-03-24');
    assert.equal(payload.totalMs, 7200000);
    assert.equal(payload.items.length, 2);
    assert.equal(payload.items[0].key, 'service:chatgpt');
    assert.equal(payload.items[0].totalMs, 5400000);
  } finally {
    await fixture.cleanup();
  }
});

test('search command aggregates matches across all days', async () => {
  const fixture = await createFixtureDataFile();

  try {
    const result = runCli(['search', '--query', 'chatgpt', '--format', 'json'], {
      APP_USAGE_TRACKER_DATA_FILE: fixture.dataFilePath
    });
    assert.equal(result.status, 0, result.stderr);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.kind, 'search');
    assert.equal(payload.totalMatches, 1);
    assert.equal(payload.matches[0].key, 'service:chatgpt');
    assert.equal(payload.matches[0].totalMs, 9000000);
    assert.equal(payload.matches[0].dayCount, 2);
  } finally {
    await fixture.cleanup();
  }
});

test('detail command returns full history for an item key', async () => {
  const fixture = await createFixtureDataFile();

  try {
    const result = runCli(['detail', '--key', 'service:chatgpt', '--format', 'json', '--data-file', fixture.dataFilePath]);
    assert.equal(result.status, 0, result.stderr);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.kind, 'detail');
    assert.equal(payload.item.key, 'service:chatgpt');
    assert.equal(payload.item.totalMs, 9000000);
    assert.equal(payload.item.todayTotalMs, 5400000);
    assert.deepEqual(
      payload.item.lastSevenDays.map((day) => [day.dayKey, day.totalMs]),
      [
        ['2026-03-23', 3600000],
        ['2026-03-24', 5400000]
      ]
    );
  } finally {
    await fixture.cleanup();
  }
});

test('days command totals only include visible items from settings', async () => {
  const fixture = await createFixtureDataFile({
    hiddenItemKeys: ['service:chatgpt', 'app:vscode:abc123']
  });

  try {
    const result = runCli(['days', '--format', 'json', '--data-file', fixture.dataFilePath]);
    assert.equal(result.status, 0, result.stderr);

    const payload = JSON.parse(result.stdout);
    assert.deepEqual(payload.availableDays, [
      {
        dayKey: '2026-03-23',
        totalMs: 1800000,
        totalMinutes: 30
      },
      {
        dayKey: '2026-03-24',
        totalMs: 0,
        totalMinutes: 0
      }
    ]);
  } finally {
    await fixture.cleanup();
  }
});

test('search command excludes items hidden by settings', async () => {
  const fixture = await createFixtureDataFile({
    hiddenItemKeys: ['service:chatgpt']
  });

  try {
    const result = runCli(['search', '--query', 'chatgpt', '--format', 'json', '--data-file', fixture.dataFilePath]);
    assert.equal(result.status, 0, result.stderr);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.kind, 'search');
    assert.equal(payload.totalMatches, 0);
    assert.deepEqual(payload.matches, []);
  } finally {
    await fixture.cleanup();
  }
});
