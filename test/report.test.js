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
  host = '',
  mediaTitle = '',
  mediaArtist = '',
  trackingMode = '',
  totalMs,
  hourly
}) {
  return {
    key,
    kind,
    label,
    subtitle: label,
    appName: label,
    browserFamily: null,
    pageTitle: '',
    windowTitle: label,
    url: '',
    host,
    path: '',
    executablePath: '',
    trackingMode,
    trackingSource: '',
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
    totalMs,
    hourly,
    color: '#1c8cff',
    lastSeenAt: 0
  };
}

async function createFixtureDataFile({ hiddenItemKeys = [], days = null } = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'app-usage-tracker-report-'));
  const dataFilePath = path.join(tempDir, 'usage-data.json');

  if (days !== null) {
    await fs.writeFile(dataFilePath, JSON.stringify({ version: 5, days }, null, 2), 'utf8');
  } else {
    const chatgptDayOne = createItem({
      key: 'service:chatgpt',
      kind: 'service',
      label: 'ChatGPT',
      host: 'chatgpt.com',
      totalMs: 3600000,
      hourly: createHourly(9, 3600000)
    });
    const githubDayOne = createItem({
      key: 'site:github',
      kind: 'site',
      label: 'github',
      host: 'github.com',
      totalMs: 1800000,
      hourly: createHourly(10, 1800000)
    });
    const chatgptDayTwo = createItem({
      key: 'service:chatgpt',
      kind: 'service',
      label: 'ChatGPT',
      host: 'chatgpt.com',
      totalMs: 5400000,
      hourly: createHourly(11, 5400000)
    });
    const vscodeDayTwo = createItem({
      key: 'app:vscode:abc123',
      kind: 'app',
      label: 'Visual Studio Code',
      totalMs: 1800000,
      hourly: createHourly(15, 1800000)
    });
    const vscodeDayThree = createItem({
      key: 'app:vscode:abc123',
      kind: 'app',
      label: 'Visual Studio Code',
      totalMs: 7200000,
      hourly: createHourly(9, 7200000)
    });
    const spotifyDayThree = createItem({
      key: 'playback:spotify',
      kind: 'playback',
      label: 'Spotify',
      mediaTitle: 'Focus Mix',
      mediaArtist: 'Various Artists',
      trackingMode: 'playback',
      totalMs: 3600000,
      hourly: createHourly(20, 3600000)
    });
    const githubDayThree = createItem({
      key: 'site:github',
      kind: 'site',
      label: 'github',
      host: 'github.com',
      totalMs: 900000,
      hourly: createHourly(14, 900000)
    });

    await fs.writeFile(dataFilePath, JSON.stringify({
      version: 5,
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
        },
        '2026-03-25': {
          totalMs: vscodeDayThree.totalMs + spotifyDayThree.totalMs + githubDayThree.totalMs,
          items: {
            [vscodeDayThree.key]: vscodeDayThree,
            [spotifyDayThree.key]: spotifyDayThree,
            [githubDayThree.key]: githubDayThree
          }
        }
      }
    }, null, 2), 'utf8');
  }

  await fs.writeFile(path.join(tempDir, 'settings.json'), JSON.stringify({ hiddenItemKeys }, null, 2), 'utf8');

  return {
    dataFilePath,
    tempDir,
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

test('report command aggregates the requested window in json', async () => {
  const fixture = await createFixtureDataFile();

  try {
    const result = runCli(['report', '--days', '2', '--format', 'json', '--data-file', fixture.dataFilePath]);
    assert.equal(result.status, 0, result.stderr);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.kind, 'report');
    assert.deepEqual(payload.dayKeys, ['2026-03-24', '2026-03-25']);
    assert.equal(payload.totalMs, 18900000);
    assert.equal(payload.totalMinutes, 315);
    assert.equal(payload.activeDayCount, 2);
    assert.equal(payload.busiestDayKey, '2026-03-25');
    assert.equal(payload.busiestHour, 9);
    assert.equal(payload.topItems[0].key, 'app:vscode:abc123');
    assert.equal(payload.topItems[0].totalMs, 9000000);
    assert.equal(payload.topItems[0].share, 47.6);
    assert.equal(payload.topItems[0].activeDayCount, 2);
    assert.equal(payload.playbackItems.length, 1);
    assert.equal(payload.playbackItems[0].mediaTitle, 'Focus Mix');
    assert.equal(payload.playbackItems[0].totalMs, 3600000);
    assert.equal(payload.kindSplit.playback.totalMs, 3600000);
    assert.equal(payload.kindSplit.app.totalMs, 9000000);
    assert.equal(payload.kindSplit.site.totalMs, 900000);
    assert.equal(payload.kindSplit.service.totalMs, 5400000);
    assert.equal(payload.categories[0].categoryLabel, 'Uncategorized');
    assert.deepEqual(
      payload.dailyTotals.map((day) => [day.dayKey, day.totalMinutes, day.itemCount, day.topItemLabel]),
      [
        ['2026-03-24', 120, 2, 'ChatGPT'],
        ['2026-03-25', 195, 3, 'Visual Studio Code']
      ]
    );
  } finally {
    await fixture.cleanup();
  }
});

test('report command defaults to a markdown document', async () => {
  const fixture = await createFixtureDataFile();

  try {
    const result = runCli(['report', '--data-file', fixture.dataFilePath]);
    assert.equal(result.status, 0, result.stderr);

    assert.match(result.stdout, /# Usage Report: 2026-03-23 to 2026-03-25/);
    assert.match(result.stdout, /## Daily Totals/);
    assert.match(result.stdout, /\| 2026-03-25 \| 3h 15m \| 3 \|/);
    assert.match(result.stdout, /## Top Items/);
    assert.match(result.stdout, /Visual Studio Code/);
    assert.match(result.stdout, /## Activity Split/);
    assert.match(result.stdout, /## Music Playback/);
    assert.match(result.stdout, /Focus Mix/);
    assert.match(result.stdout, /## Hourly Activity/);
    assert.match(result.stdout, /## Insights/);
    assert.match(result.stdout, /Top item: ChatGPT \(2h 30m, 37%\)\./);
    assert.match(result.stdout, /Peak hour: 09:00/);
    assert.match(result.stdout, /Trend: \+63% vs the previous day\./);
  } finally {
    await fixture.cleanup();
  }
});

test('report command exports a daily totals csv', async () => {
  const fixture = await createFixtureDataFile();

  try {
    const result = runCli(['report', '--days', '1', '--format', 'csv', '--data-file', fixture.dataFilePath]);
    assert.equal(result.status, 0, result.stderr);

    assert.deepEqual(result.stdout.trim().split(/\r?\n/), [
      'day,total_minutes,item_count,top_item,top_item_minutes',
      '2026-03-25,195,3,Visual Studio Code,120'
    ]);
  } finally {
    await fixture.cleanup();
  }
});

test('report command excludes items hidden by settings', async () => {
  const fixture = await createFixtureDataFile({ hiddenItemKeys: ['service:chatgpt'] });

  try {
    const result = runCli(['report', '--days', '2', '--format', 'json', '--data-file', fixture.dataFilePath]);
    assert.equal(result.status, 0, result.stderr);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.totalMs, 13500000);
    assert.equal(payload.totalMinutes, 225);
    assert.ok(!payload.topItems.some((item) => item.key === 'service:chatgpt'));
    assert.equal(payload.kindSplit.service.totalMs, 0);
    assert.equal(payload.categories[0].totalMs, 13500000);
  } finally {
    await fixture.cleanup();
  }
});

test('report command writes to a file with --output', async () => {
  const fixture = await createFixtureDataFile();
  const outputPath = path.join(fixture.tempDir, 'weekly.md');

  try {
    const result = runCli(['report', '--days', '2', '--output', outputPath, '--data-file', fixture.dataFilePath]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Report written to/);

    const written = await fs.readFile(outputPath, 'utf8');
    assert.match(written, /# Usage Report: 2026-03-24 to 2026-03-25/);
  } finally {
    await fixture.cleanup();
  }
});

test('report command rejects an invalid --days value', async () => {
  const fixture = await createFixtureDataFile();

  try {
    const result = runCli(['report', '--days', '0', '--data-file', fixture.dataFilePath]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid value "0" for --days/);
  } finally {
    await fixture.cleanup();
  }
});

test('report command handles empty data gracefully', async () => {
  const fixture = await createFixtureDataFile({ days: {} });

  try {
    const result = runCli(['report', '--data-file', fixture.dataFilePath]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /# Usage Report: no data/);
    assert.match(result.stdout, /No tracking data available\./);
  } finally {
    await fixture.cleanup();
  }
});
