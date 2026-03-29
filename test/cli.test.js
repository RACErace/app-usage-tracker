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

function createLocalTimestamp(year, monthIndex, day, hour, minute = 0, second = 0) {
  return new Date(year, monthIndex, day, hour, minute, second, 0).getTime();
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

function createSession({
  key,
  kind,
  label,
  subtitle,
  appName,
  host = '',
  pageHost = '',
  url = '',
  pageTitle = '',
  executablePath = '',
  startedAt,
  endedAt,
  trackingMode = '',
  trackingSource = '',
  mediaTitle = '',
  mediaArtist = ''
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
    pageHost,
    path: '',
    executablePath,
    categoryId: '',
    categoryLabel: '',
    trackingMode,
    trackingSource,
    sourceAppUserModelId: '',
    mediaTitle,
    mediaArtist,
    mediaAlbumTitle: '',
    playbackStatus: '',
    playbackType: '',
    processId: 0,
    processName: '',
    audioSessionState: '',
    audioPeakValue: 0,
    audioIsMuted: false,
    audioEndpointId: '',
    audioSessionIdentifier: '',
    audioSessionInstanceIdentifier: '',
    color: '#1c8cff',
    startedAt,
    endedAt
  };
}

async function createFixtureDataFile({ hiddenItemKeys = [] } = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'app-usage-tracker-cli-'));
  const dataFilePath = path.join(tempDir, 'usage-data.json');
  const chatgptDayOneSession = createSession({
    key: 'service:chatgpt',
    kind: 'service',
    label: 'ChatGPT',
    subtitle: 'Daily AI work',
    appName: 'ChatGPT',
    host: 'chatgpt.com',
    pageHost: 'chatgpt.com',
    url: 'https://chatgpt.com/',
    pageTitle: 'ChatGPT',
    startedAt: createLocalTimestamp(2026, 2, 23, 9, 0, 0),
    endedAt: createLocalTimestamp(2026, 2, 23, 10, 0, 0)
  });
  const githubDayOneSession = createSession({
    key: 'site:github',
    kind: 'site',
    label: 'github',
    subtitle: 'Repository review',
    appName: 'Chrome',
    host: 'github.com',
    pageHost: 'github.com',
    url: 'https://github.com/openai',
    pageTitle: 'openai',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    startedAt: createLocalTimestamp(2026, 2, 23, 10, 0, 0),
    endedAt: createLocalTimestamp(2026, 2, 23, 10, 30, 0)
  });
  const chatgptDayTwoSession = createSession({
    key: 'service:chatgpt',
    kind: 'service',
    label: 'ChatGPT',
    subtitle: 'Prompting session',
    appName: 'ChatGPT',
    host: 'chatgpt.com',
    pageHost: 'chatgpt.com',
    url: 'https://chatgpt.com/',
    pageTitle: 'ChatGPT',
    startedAt: createLocalTimestamp(2026, 2, 24, 11, 0, 0),
    endedAt: createLocalTimestamp(2026, 2, 24, 12, 30, 0)
  });
  const vscodeDayTwoSession = createSession({
    key: 'app:vscode:abc123',
    kind: 'app',
    label: 'Visual Studio Code',
    subtitle: 'src/cli/query.js',
    appName: 'Visual Studio Code',
    executablePath: 'C:\\Users\\race2\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
    startedAt: createLocalTimestamp(2026, 2, 24, 15, 0, 0),
    endedAt: createLocalTimestamp(2026, 2, 24, 15, 30, 0)
  });
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
    lastSeenAt: chatgptDayOneSession.endedAt
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
    lastSeenAt: githubDayOneSession.endedAt
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
    lastSeenAt: chatgptDayTwoSession.endedAt
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
    lastSeenAt: vscodeDayTwoSession.endedAt
  });

  await fs.writeFile(dataFilePath, JSON.stringify({
    version: 5,
    days: {
      '2026-03-23': {
        totalMs: chatgptDayOne.totalMs + githubDayOne.totalMs,
        sessions: [
          chatgptDayOneSession,
          githubDayOneSession
        ],
        items: {
          [chatgptDayOne.key]: chatgptDayOne,
          [githubDayOne.key]: githubDayOne
        }
      },
      '2026-03-24': {
        totalMs: chatgptDayTwo.totalMs + vscodeDayTwo.totalMs,
        sessions: [
          chatgptDayTwoSession,
          vscodeDayTwoSession
        ],
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

test('timeline command returns real sessions for the requested day in json', async () => {
  const fixture = await createFixtureDataFile();

  try {
    const result = runCli(['timeline', '--day', '2026-03-24', '--limit', '5', '--format', 'json', '--data-file', fixture.dataFilePath]);
    assert.equal(result.status, 0, result.stderr);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.kind, 'timeline');
    assert.equal(payload.dayKey, '2026-03-24');
    assert.equal(payload.totalMs, 7200000);
    assert.equal(payload.sessionCount, 2);
    assert.equal(payload.returnedSessionCount, 2);
    assert.deepEqual(
      payload.sessions.map((session) => [session.key, session.startClock, session.endClock, session.durationMs, session.kindLabel]),
      [
        ['service:chatgpt', '11:00:00', '12:30:00', 5400000, 'web'],
        ['app:vscode:abc123', '15:00:00', '15:30:00', 1800000, 'foreground']
      ]
    );
  } finally {
    await fixture.cleanup();
  }
});

test('timeline command excludes items hidden by settings', async () => {
  const fixture = await createFixtureDataFile({
    hiddenItemKeys: ['service:chatgpt']
  });

  try {
    const result = runCli(['timeline', '--day', '2026-03-24', '--format', 'json', '--data-file', fixture.dataFilePath]);
    assert.equal(result.status, 0, result.stderr);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.kind, 'timeline');
    assert.equal(payload.totalMs, 1800000);
    assert.equal(payload.sessionCount, 1);
    assert.equal(payload.sessions.length, 1);
    assert.equal(payload.sessions[0].key, 'app:vscode:abc123');
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
