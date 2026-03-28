const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { getBackupFilePath } = require('../src/main/json-storage');
const {
  BRIDGE_SHARED_HEADER_NAME,
  BRIDGE_SHARED_HEADER_VALUE,
  UsageTracker,
  migrateUsageData,
  __testables
} = require('../src/main/tracker');

function createPersistedUsageData(label = 'Notepad') {
  return {
    version: 3,
    days: {
      '2026-03-25': {
        totalMs: 120000,
        items: {
          'app:notepad': {
            key: 'app:notepad',
            kind: 'app',
            label,
            subtitle: `${label} Window`,
            appName: label,
            browserFamily: null,
            pageTitle: '',
            windowTitle: `${label} Window`,
            url: '',
            host: '',
            path: '',
            executablePath: 'C:\\Windows\\notepad.exe',
            trackingMode: 'foreground',
            trackingSource: 'foreground',
            sourceAppUserModelId: '',
            mediaTitle: '',
            mediaArtist: '',
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
            totalMs: 120000,
            hourly: new Array(24).fill(0),
            color: '#1c8cff',
            lastSeenAt: 1
          }
        }
      }
    }
  };
}

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

test('music app profiles match desktop app names and SMTC source ids', () => {
  assert.equal(
    __testables.findMusicAppProfile({
      appName: 'QQMusic',
      executablePath: 'C:\\Program Files\\QQMusic\\QQMusic.exe'
    })?.id,
    'qqmusic'
  );

  assert.equal(
    __testables.findMusicAppProfile({
      sourceAppUserModelId: 'AppleInc.AppleMusicWin_nzyj5cx40ttqa!App'
    })?.id,
    'apple-music'
  );
});

test('SMTC music session filtering ignores paused sessions and browser sessions', () => {
  assert.equal(__testables.isTrackableMusicSession({
    sourceAppUserModelId: 'QQMusic.exe',
    playbackStatus: 'Playing',
    playbackType: 'Unknown'
  }), true);

  assert.equal(__testables.isTrackableMusicSession({
    sourceAppUserModelId: 'QQMusic.exe',
    playbackStatus: 'Paused',
    playbackType: 'Music'
  }), false);

  assert.equal(__testables.isTrackableMusicSession({
    sourceAppUserModelId: 'msedge.exe',
    playbackStatus: 'Playing',
    playbackType: 'Music'
  }), false);
});

test('WASAPI session filtering accepts active music apps and rejects browsers', () => {
  assert.equal(__testables.isTrackableWasapiSession({
    state: 'Active',
    processId: 123,
    processName: 'CloudMusic',
    executablePath: 'C:\\Program Files\\NetEase\\CloudMusic\\cloudmusic.exe',
    displayName: '网易云音乐'
  }), true);

  assert.equal(__testables.isTrackableWasapiSession({
    state: 'Inactive',
    processId: 123,
    processName: 'QQMusic',
    executablePath: 'C:\\Program Files\\QQMusic\\QQMusic.exe',
    displayName: 'QQ音乐'
  }), false);

  assert.equal(__testables.isTrackableWasapiSession({
    state: 'Active',
    processId: 123,
    processName: 'msedge',
    executablePath: 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    displayName: 'Edge'
  }), false);
});

test('fusion prefers SMTC metadata and WASAPI process details for the same music app', () => {
  const [candidate] = __testables.fusePlaybackCandidates({
    smtcSessions: [{
      sourceAppUserModelId: 'QQMusic.exe',
      playbackStatus: 'Playing',
      playbackType: 'Music',
      title: '寄り道 (Detour)',
      artist: 'とた',
      albumTitle: 'Sebone'
    }],
    wasapiSessions: [{
      endpointId: 'default-device',
      state: 'Active',
      peakValue: 0.42,
      isMuted: false,
      processId: 321,
      processName: 'QQMusic',
      executablePath: 'C:\\Program Files\\QQMusic\\QQMusic.exe',
      sessionIdentifier: 'session-id',
      sessionInstanceIdentifier: 'session-instance',
      displayName: 'QQ 音乐',
      iconPath: ''
    }]
  });

  assert.equal(candidate.key, 'music:qqmusic');
  assert.equal(candidate.trackingSource, 'hybrid');
  assert.equal(candidate.mediaTitle, '寄り道 (Detour)');
  assert.equal(candidate.processName, 'QQMusic');
  assert.equal(candidate.audioSessionState, 'Active');
  assert.equal(candidate.audioPeakValue, 0.42);
});

test('playback entries reuse stable music keys and suppress duplicate foreground counting', () => {
  const tracker = new UsageTracker({
    userDataPath: path.join(__dirname, '.tmp-tracker'),
    onDataChanged: null
  });

  const now = 1700000000000;
  const foregroundEntry = tracker.normalizeWindow({
    title: '正在播放',
    owner: {
      name: 'QQMusic',
      path: 'C:\\Program Files\\QQMusic\\QQMusic.exe'
    }
  }, now);

  assert.equal(foregroundEntry.key, 'music:qqmusic');

  const playbackEntry = tracker.createPlaybackEntryFromSession({
    sourceAppUserModelId: 'QQMusic.exe',
    playbackStatus: 'Playing',
    playbackType: 'Music',
    title: '寄り道 (Detour)',
    artist: 'とた',
    albumTitle: 'Sebone'
  }, now);

  assert.equal(playbackEntry.key, 'music:qqmusic');
  assert.equal(playbackEntry.subtitle, 'とた - 寄り道 (Detour)');

  tracker.replacePlaybackEntries(__testables.fusePlaybackCandidates({
    smtcSessions: [{
      sourceAppUserModelId: 'QQMusic.exe',
      playbackStatus: 'Playing',
      playbackType: 'Music',
      title: '寄り道 (Detour)',
      artist: 'とた',
      albumTitle: 'Sebone'
    }],
    wasapiSessions: []
  }), now);

  assert.equal(tracker.shouldSuppressForegroundEntry(foregroundEntry), true);
});

test('SMTC json parser normalizes single-object payloads', () => {
  const [session] = __testables.parseSmtcSnapshotOutput('{"sourceAppUserModelId":"QQMusic.exe","playbackStatus":"Playing","playbackType":"Music","title":"Track","artist":"Artist","albumTitle":"Album"}');

  assert.deepEqual(session, {
    sourceAppUserModelId: 'QQMusic.exe',
    playbackStatus: 'Playing',
    playbackType: 'Music',
    title: 'Track',
    artist: 'Artist',
    albumTitle: 'Album'
  });
});

test('WASAPI json parser normalizes single-object payloads', () => {
  const [session] = __testables.parseWasapiSnapshotOutput('{"endpointId":"default","state":"Active","peakValue":0.25,"isMuted":false,"processId":888,"processName":"QQMusic","executablePath":"C:\\\\Program Files\\\\QQMusic\\\\QQMusic.exe","sessionIdentifier":"sid","sessionInstanceIdentifier":"iid","displayName":"QQ 音乐","iconPath":""}');

  assert.deepEqual(session, {
    endpointId: 'default',
    state: 'Active',
    peakValue: 0.25,
    isMuted: false,
    processId: 888,
    processName: 'QQMusic',
    executablePath: 'C:\\Program Files\\QQMusic\\QQMusic.exe',
    sessionIdentifier: 'sid',
    sessionInstanceIdentifier: 'iid',
    displayName: 'QQ 音乐',
    iconPath: ''
  });
});

test('helper-backed fusion service returns cached helper snapshots', async () => {
  const sentMessages = [];
  const fakeChild = new EventEmitter();
  fakeChild.send = (message) => {
    sentMessages.push(message);
    if (message?.type === 'shutdown') {
      fakeChild.emit('exit', 0);
    }
  };
  fakeChild.kill = () => {
    fakeChild.emit('exit', 0);
    return true;
  };

  const service = new __testables.HelperBackedPlaybackSessionFusionService({
    spawnHelper: () => fakeChild,
    restartDelayMs: 1
  });

  const firstSnapshot = await service.poll();
  assert.deepEqual(firstSnapshot, []);

  fakeChild.emit('message', {
    type: 'snapshot',
    updatedAt: 123,
    snapshot: [{
      key: 'music:qqmusic',
      label: 'QQ音乐',
      appName: 'QQ音乐',
      subtitle: 'とた - 寄り道 (Detour)',
      providers: ['smtc', 'wasapi'],
      trackingMode: 'playback',
      trackingSource: 'hybrid'
    }]
  });

  const secondSnapshot = await service.poll();
  assert.equal(secondSnapshot[0].key, 'music:qqmusic');
  assert.deepEqual(secondSnapshot[0].providers, ['smtc', 'wasapi']);
  assert.notEqual(secondSnapshot[0], service.latestSnapshot[0]);

  await service.dispose();
  assert.equal(sentMessages.some((message) => message?.type === 'shutdown'), true);
});

test('browser extension cache tracks heartbeat freshness separately from page events', () => {
  const originalNow = Date.now;
  let now = 1000;
  Date.now = () => now;

  try {
    const cache = new __testables.BrowserEventCache({
      eventTtlMs: 1000,
      heartbeatTtlMs: 2000
    });

    cache.upsertHeartbeat({
      browserFamily: 'Edge',
      extensionVersion: '1.1.1',
      sentAt: 900
    });

    cache.upsert({
      browserFamily: 'Edge',
      extensionVersion: '1.1.1',
      pageTitle: 'OpenAI Docs',
      url: 'https://platform.openai.com/docs'
    });

    assert.equal(cache.getFresh('Edge')?.host, 'platform.openai.com');

    let status = cache.getExtensionStatus();
    assert.equal(status.status, 'connected');
    assert.deepEqual(status.activeBrowsers, ['Edge']);
    assert.equal(status.browsers[0].extensionVersion, '1.1.1');

    now = 2505;
    assert.equal(cache.getFresh('Edge'), null);

    status = cache.getExtensionStatus();
    assert.equal(status.status, 'connected');
    assert.equal(status.browsers[0].isActive, true);

    now = 3105;
    status = cache.getExtensionStatus();
    assert.equal(status.status, 'missing');
    assert.equal(status.browsers[0].isActive, false);
  } finally {
    Date.now = originalNow;
  }
});

test('snapshot meta exposes browser extension status for renderer prompts', () => {
  const originalNow = Date.now;
  let now = 5000;
  Date.now = () => now;

  try {
    const tracker = new UsageTracker({
      userDataPath: path.join(__dirname, '.tmp-tracker-snapshot'),
      onDataChanged: null
    });

    tracker.browserEvents.upsertHeartbeat({
      browserFamily: 'Chrome',
      extensionVersion: '1.1.1',
      sentAt: 4900
    });

    const snapshot = tracker.getSnapshot();
    assert.equal(snapshot.meta.bridgeUrl, 'http://127.0.0.1:32123/v1/browser-event');
    assert.equal(snapshot.meta.browserExtensionStatus.status, 'connected');
    assert.deepEqual(snapshot.meta.browserExtensionStatus.activeBrowsers, ['Chrome']);
  } finally {
    Date.now = originalNow;
  }
});

test('usage tracker restores from backup when primary file is structurally invalid', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-tracker-recover-'));
  const dataFilePath = path.join(tempDir, 'usage-data.json');

  try {
    const tracker = new UsageTracker({
      userDataPath: tempDir,
      onDataChanged: null
    });

    tracker.data = createPersistedUsageData('Original Record');
    await tracker.save();

    const backupFilePath = getBackupFilePath(dataFilePath);
    const backupContent = JSON.parse(await fs.readFile(backupFilePath, 'utf8'));
    assert.equal(backupContent.days['2026-03-25'].items['app:notepad'].label, 'Original Record');

    await fs.writeFile(dataFilePath, '{}', 'utf8');

    const recoveredTracker = new UsageTracker({
      userDataPath: tempDir,
      onDataChanged: null
    });

    await recoveredTracker.load();

    assert.equal(recoveredTracker.data.days['2026-03-25'].items['app:notepad'].label, 'Original Record');

    const files = await fs.readdir(tempDir);
    assert.equal(files.some((fileName) => fileName.startsWith('usage-data.json.corrupt-')), true);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('usage tracker serializes concurrent saves so newer snapshots cannot be overwritten by older writes', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-tracker-save-'));
  const originalWriteFile = fs.writeFile;

  try {
    fs.writeFile = async (filePath, content, ...rest) => {
      if (
        typeof filePath === 'string'
        && filePath.endsWith('.tmp')
        && typeof content === 'string'
        && content.includes('"First Snapshot"')
      ) {
        await new Promise((resolve) => setTimeout(resolve, 80));
      }

      return originalWriteFile.call(fs, filePath, content, ...rest);
    };

    const tracker = new UsageTracker({
      userDataPath: tempDir,
      onDataChanged: null
    });

    tracker.data = createPersistedUsageData('First Snapshot');
    const firstSave = tracker.save();

    tracker.data = createPersistedUsageData('Second Snapshot');
    const secondSave = tracker.save();

    await Promise.all([firstSave, secondSave]);

    const persisted = JSON.parse(await fs.readFile(path.join(tempDir, 'usage-data.json'), 'utf8'));
    assert.equal(persisted.days['2026-03-25'].items['app:notepad'].label, 'Second Snapshot');
  } finally {
    fs.writeFile = originalWriteFile;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
