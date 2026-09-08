#!/usr/bin/env node

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { UsageTracker } = require('../main/tracker');

class CliError extends Error {}

function formatDuration(ms) {
  const totalMinutes = Math.round((Number(ms) || 0) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${hours}h`;
  }

  return `${minutes}m`;
}

function toMinutes(ms) {
  return Math.round((Number(ms) || 0) / 60000);
}

function normalizeSearchText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeHiddenItemKeys(hiddenItemKeys) {
  if (!Array.isArray(hiddenItemKeys)) {
    return [];
  }

  return [...new Set(
    hiddenItemKeys
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim())
  )];
}

function getDefaultUserDataDir() {
  if (process.env.APP_USAGE_TRACKER_USER_DATA_DIR) {
    return path.resolve(process.env.APP_USAGE_TRACKER_USER_DATA_DIR);
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'app-usage-tracker');
  }

  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configHome, 'app-usage-tracker');
}

function resolveStoragePaths(values) {
  const dataFilePath = values['data-file'] || process.env.APP_USAGE_TRACKER_DATA_FILE;
  if (dataFilePath) {
    const resolvedDataFilePath = path.resolve(dataFilePath);
    return {
      userDataPath: path.dirname(resolvedDataFilePath),
      dataFilePath: resolvedDataFilePath
    };
  }

  const userDataPath = path.resolve(values['user-data-dir'] || getDefaultUserDataDir());
  return {
    userDataPath,
    dataFilePath: path.join(userDataPath, 'usage-data.json')
  };
}

function getSharedOptions(extraOptions = {}) {
  return {
    format: { type: 'string' },
    json: { type: 'boolean' },
    'user-data-dir': { type: 'string' },
    'data-file': { type: 'string' },
    help: { type: 'boolean' },
    ...extraOptions
  };
}

function parseCommandArgs(args, extraOptions = {}) {
  return parseArgs({
    args,
    allowPositionals: true,
    options: getSharedOptions(extraOptions),
    strict: true
  });
}

async function loadTracker(values) {
  const paths = resolveStoragePaths(values);
  const settings = await loadSettings(paths);
  const tracker = new UsageTracker({
    userDataPath: paths.userDataPath,
    onDataChanged: null,
    ruleSettings: {
      customServiceRules: settings.customServiceRules,
      categoryRules: settings.categoryRules
    }
  });

  tracker.dataFilePath = paths.dataFilePath;
  await tracker.load();
  const hiddenItemKeySet = new Set(settings.hiddenItemKeys);
  const snapshot = filterSnapshot(tracker.getSnapshot(), hiddenItemKeySet);

  return {
    tracker,
    paths,
    settings,
    hiddenItemKeySet,
    snapshot
  };
}

async function loadSettings(paths) {
  const settingsFilePath = path.join(paths.userDataPath, 'settings.json');

  try {
    const rawSettings = await fs.readFile(settingsFilePath, 'utf8');
    const parsed = JSON.parse(rawSettings);
    return {
      hiddenItemKeys: normalizeHiddenItemKeys(parsed?.hiddenItemKeys),
      customServiceRules: Array.isArray(parsed?.customServiceRules) ? parsed.customServiceRules : [],
      categoryRules: Array.isArray(parsed?.categoryRules) ? parsed.categoryRules : []
    };
  } catch {
    return {
      hiddenItemKeys: [],
      customServiceRules: [],
      categoryRules: []
    };
  }
}

function mergeHourly(items) {
  const hourly = new Array(24).fill(0);

  for (const item of items) {
    (item.hourly || []).forEach((value, index) => {
      hourly[index] += Number(value) || 0;
    });
  }

  return hourly;
}

function filterDay(day, hiddenItemKeySet) {
  const items = (day?.items || []).filter((item) => !hiddenItemKeySet.has(item.key));

  return {
    totalMs: items.reduce((sum, item) => sum + (Number(item.totalMs) || 0), 0),
    items,
    hourly: mergeHourly(items)
  };
}

function buildFilteredWeekly(snapshot, hiddenItemKeySet) {
  const dayKeys = snapshot?.weekly?.dayKeys || [];
  const weeklyMap = new Map();
  let totalMs = 0;

  const dailyTotals = dayKeys.map((dayKey) => {
    const filteredDay = filterDay(snapshot?.daily?.days?.[dayKey], hiddenItemKeySet);
    totalMs += filteredDay.totalMs;

    filteredDay.items.forEach((item) => {
      const existing = weeklyMap.get(item.key);
      if (!existing) {
        weeklyMap.set(item.key, {
          ...item,
          totalMs: item.totalMs,
          hourly: [...(item.hourly || new Array(24).fill(0))],
          byDay: { [dayKey]: item.totalMs }
        });
        return;
      }

      existing.totalMs += item.totalMs;
      existing.byDay[dayKey] = item.totalMs;
      existing.hourly = existing.hourly.map((value, index) => value + ((item.hourly && item.hourly[index]) || 0));
      existing.label = item.label;
      existing.subtitle = item.subtitle;
      existing.url = item.url || existing.url;
      existing.host = item.host || existing.host;
      existing.pageTitle = item.pageTitle || existing.pageTitle;
      existing.appName = item.appName || existing.appName;
      existing.executablePath = item.executablePath || existing.executablePath;
      existing.browserFamily = item.browserFamily || existing.browserFamily;
      existing.categoryId = item.categoryId || existing.categoryId || '';
      existing.categoryLabel = item.categoryLabel || existing.categoryLabel || '';
      existing.lastSeenAt = item.lastSeenAt || existing.lastSeenAt;
      existing.trackingMode = item.trackingMode || existing.trackingMode;
      existing.trackingSource = item.trackingSource || existing.trackingSource;
      existing.sourceAppUserModelId = item.sourceAppUserModelId || existing.sourceAppUserModelId;
      existing.mediaTitle = item.mediaTitle || existing.mediaTitle;
      existing.mediaArtist = item.mediaArtist || existing.mediaArtist;
      existing.mediaAlbumTitle = item.mediaAlbumTitle || existing.mediaAlbumTitle;
      existing.playbackStatus = item.playbackStatus || existing.playbackStatus;
      existing.playbackType = item.playbackType || existing.playbackType;
      existing.processId = item.processId || existing.processId || 0;
      existing.processName = item.processName || existing.processName;
      existing.audioSessionState = item.audioSessionState || existing.audioSessionState;
      existing.audioPeakValue = Math.max(Number(existing.audioPeakValue) || 0, Number(item.audioPeakValue) || 0);
      existing.audioIsMuted = typeof item.audioIsMuted === 'boolean' ? item.audioIsMuted : existing.audioIsMuted;
      existing.audioEndpointId = item.audioEndpointId || existing.audioEndpointId;
      existing.audioSessionIdentifier = item.audioSessionIdentifier || existing.audioSessionIdentifier;
      existing.audioSessionInstanceIdentifier = item.audioSessionInstanceIdentifier || existing.audioSessionInstanceIdentifier;
    });

    return { dayKey, totalMs: filteredDay.totalMs };
  });

  return {
    dayKeys,
    totalMs,
    averageMs: dayKeys.length ? Math.round(totalMs / dayKeys.length) : 0,
    dailyTotals,
    items: [...weeklyMap.values()].sort((left, right) => right.totalMs - left.totalMs)
  };
}

function filterSnapshot(snapshot, hiddenItemKeySet) {
  if (!hiddenItemKeySet.size) {
    return snapshot;
  }

  const filteredDays = Object.fromEntries(
    Object.entries(snapshot?.daily?.days || {}).map(([dayKey, day]) => [dayKey, filterDay(day, hiddenItemKeySet)])
  );
  const latestDayKey = snapshot?.meta?.latestDayKey || null;
  const currentDay = filteredDays[latestDayKey] || {
    totalMs: 0,
    hourly: new Array(24).fill(0),
    items: []
  };

  return {
    ...snapshot,
    daily: {
      ...snapshot.daily,
      days: filteredDays,
      totalMs: currentDay.totalMs,
      hourly: [...currentDay.hourly],
      items: currentDay.items
    },
    weekly: buildFilteredWeekly({
      ...snapshot,
      daily: {
        ...snapshot.daily,
        days: filteredDays
      }
    }, hiddenItemKeySet)
  };
}

function buildCatalog(snapshot) {
  const catalog = new Map();

  for (const [dayKey, day] of Object.entries(snapshot?.daily?.days || {})) {
    for (const item of day.items || []) {
      const itemTotalMs = Number(item.totalMs) || 0;
      const existing = catalog.get(item.key);

      if (!existing) {
        catalog.set(item.key, {
          ...item,
          dayCount: itemTotalMs > 0 ? 1 : 0,
          firstSeenDayKey: dayKey,
          lastSeenDayKey: dayKey
        });
        continue;
      }

      existing.totalMs += itemTotalMs;
      existing.dayCount += itemTotalMs > 0 ? 1 : 0;
      existing.lastSeenDayKey = dayKey;
      if ((Number(item.lastSeenAt) || 0) >= (Number(existing.lastSeenAt) || 0)) {
        existing.kind = item.kind;
        existing.label = item.label;
        existing.subtitle = item.subtitle;
        existing.appName = item.appName;
        existing.browserFamily = item.browserFamily;
        existing.pageTitle = item.pageTitle;
        existing.windowTitle = item.windowTitle;
        existing.url = item.url;
        existing.host = item.host;
        existing.path = item.path;
        existing.executablePath = item.executablePath;
        existing.categoryId = item.categoryId || existing.categoryId || '';
        existing.categoryLabel = item.categoryLabel || existing.categoryLabel || '';
        existing.trackingMode = item.trackingMode;
        existing.trackingSource = item.trackingSource;
        existing.sourceAppUserModelId = item.sourceAppUserModelId;
        existing.mediaTitle = item.mediaTitle;
        existing.mediaArtist = item.mediaArtist;
        existing.mediaAlbumTitle = item.mediaAlbumTitle;
        existing.playbackStatus = item.playbackStatus;
        existing.playbackType = item.playbackType;
        existing.processId = item.processId;
        existing.processName = item.processName;
        existing.audioSessionState = item.audioSessionState;
        existing.audioPeakValue = item.audioPeakValue;
        existing.audioIsMuted = item.audioIsMuted;
        existing.audioEndpointId = item.audioEndpointId;
        existing.audioSessionIdentifier = item.audioSessionIdentifier;
        existing.audioSessionInstanceIdentifier = item.audioSessionInstanceIdentifier;
        existing.color = item.color;
        existing.lastSeenAt = item.lastSeenAt;
      }
    }
  }

  return [...catalog.values()].sort((left, right) => right.totalMs - left.totalMs);
}

function summarizeItem(item) {
  return {
    key: item.key,
    kind: item.kind,
    label: item.label,
    subtitle: item.subtitle,
    appName: item.appName,
    browserFamily: item.browserFamily || null,
    categoryId: item.categoryId || '',
    categoryLabel: item.categoryLabel || '',
    pageTitle: item.pageTitle,
    host: item.host,
    url: item.url,
    executablePath: item.executablePath,
    trackingMode: item.trackingMode || '',
    trackingSource: item.trackingSource || '',
    sourceAppUserModelId: item.sourceAppUserModelId || '',
    mediaTitle: item.mediaTitle || '',
    mediaArtist: item.mediaArtist || '',
    mediaAlbumTitle: item.mediaAlbumTitle || '',
    playbackStatus: item.playbackStatus || '',
    playbackType: item.playbackType || '',
    processId: Number(item.processId) || 0,
    processName: item.processName || '',
    audioSessionState: item.audioSessionState || '',
    audioPeakValue: Number(item.audioPeakValue) || 0,
    audioIsMuted: Boolean(item.audioIsMuted),
    audioEndpointId: item.audioEndpointId || '',
    audioSessionIdentifier: item.audioSessionIdentifier || '',
    audioSessionInstanceIdentifier: item.audioSessionInstanceIdentifier || '',
    totalMs: Number(item.totalMs) || 0,
    totalMinutes: toMinutes(item.totalMs),
    color: item.color,
    lastSeenAt: Number(item.lastSeenAt) || 0
  };
}

function formatClockTime(timestamp, { includeSeconds = false } = {}) {
  const numericTimestamp = Number(timestamp) || 0;
  if (!numericTimestamp) {
    return includeSeconds ? '--:--:--' : '--:--';
  }

  const date = new Date(numericTimestamp);
  if (Number.isNaN(date.getTime())) {
    return includeSeconds ? '--:--:--' : '--:--';
  }

  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  if (!includeSeconds) {
    return `${hours}:${minutes}`;
  }

  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function getTimelineSessionKindLabel(session) {
  if (session?.trackingMode === 'playback') {
    return session?.trackingSource || 'playback';
  }

  if (session?.url || session?.kind === 'site') {
    return 'web';
  }

  return 'foreground';
}

function summarizeSession(session) {
  const startedAt = Number(session?.startedAt) || 0;
  const endedAt = Number(session?.endedAt) || 0;
  const durationMs = Number(session?.durationMs) || Math.max(endedAt - startedAt, 0);

  return {
    key: session?.key,
    kind: session?.kind,
    kindLabel: getTimelineSessionKindLabel(session),
    label: session?.label,
    subtitle: session?.subtitle,
    appName: session?.appName,
    browserFamily: session?.browserFamily || null,
    categoryId: session?.categoryId || '',
    categoryLabel: session?.categoryLabel || '',
    pageTitle: session?.pageTitle || '',
    host: session?.host || '',
    pageHost: session?.pageHost || '',
    url: session?.url || '',
    path: session?.path || '',
    executablePath: session?.executablePath || '',
    trackingMode: session?.trackingMode || '',
    trackingSource: session?.trackingSource || '',
    sourceAppUserModelId: session?.sourceAppUserModelId || '',
    mediaTitle: session?.mediaTitle || '',
    mediaArtist: session?.mediaArtist || '',
    mediaAlbumTitle: session?.mediaAlbumTitle || '',
    playbackStatus: session?.playbackStatus || '',
    playbackType: session?.playbackType || '',
    processId: Number(session?.processId) || 0,
    processName: session?.processName || '',
    audioSessionState: session?.audioSessionState || '',
    audioPeakValue: Number(session?.audioPeakValue) || 0,
    audioIsMuted: Boolean(session?.audioIsMuted),
    audioEndpointId: session?.audioEndpointId || '',
    audioSessionIdentifier: session?.audioSessionIdentifier || '',
    audioSessionInstanceIdentifier: session?.audioSessionInstanceIdentifier || '',
    color: session?.color || '',
    startedAt,
    endedAt,
    startedAtIso: startedAt ? new Date(startedAt).toISOString() : '',
    endedAtIso: endedAt ? new Date(endedAt).toISOString() : '',
    startClock: formatClockTime(startedAt, { includeSeconds: true }),
    endClock: formatClockTime(endedAt, { includeSeconds: true }),
    durationMs,
    durationMinutes: toMinutes(durationMs),
    isLive: Boolean(session?.isLive)
  };
}

function getItemSearchFields(item) {
  return [
    item.key,
    item.label,
    item.subtitle,
    item.appName,
    item.host,
    item.pageTitle,
    item.mediaTitle,
    item.mediaArtist,
    item.processName,
    item.url,
    item.windowTitle
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function getSearchScore(item, query) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return 0;
  }

  const fields = getItemSearchFields(item).map((value) => normalizeSearchText(value));
  let bestScore = 0;

  for (const field of fields) {
    if (field === normalizedQuery) {
      bestScore = Math.max(bestScore, field === normalizeSearchText(item.key) ? 120 : 110);
      continue;
    }

    if (field.startsWith(normalizedQuery)) {
      bestScore = Math.max(bestScore, 80);
      continue;
    }

    if (field.includes(normalizedQuery)) {
      bestScore = Math.max(bestScore, 60);
    }
  }

  return bestScore;
}

function searchCatalog(catalog, query, limit) {
  return catalog
    .map((item) => ({
      item,
      score: getSearchScore(item, query)
    }))
    .filter((match) => match.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return (Number(right.item.totalMs) || 0) - (Number(left.item.totalMs) || 0);
    })
    .slice(0, limit);
}

function resolveOutputFormat(values) {
  if (values.json) {
    return 'json';
  }

  return values.format === 'json' ? 'json' : 'text';
}

function assertFormat(values) {
  const format = resolveOutputFormat(values);
  if (format !== 'json' && format !== 'text') {
    throw new CliError(`Unsupported format "${values.format}". Use "text" or "json".`);
  }

  return format;
}

function parseLimit(value, fallback = 10) {
  if (value === undefined) {
    return fallback;
  }

  const limit = Number.parseInt(value, 10);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new CliError(`Invalid limit "${value}". Use a positive integer.`);
  }

  return limit;
}

function parsePositiveInteger(value, optionName, fallback) {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError(`Invalid value "${value}" for ${optionName}. Use a positive integer.`);
  }

  return parsed;
}

function resolveDayKey(snapshot, requestedDayKey) {
  if (!requestedDayKey || requestedDayKey === 'latest') {
    return snapshot?.meta?.latestDayKey || null;
  }

  return requestedDayKey;
}

function toJsonOutput(payload) {
  return JSON.stringify(payload, null, 2);
}

function toTextLinesForItems(items) {
  if (!items.length) {
    return ['No matching items.'];
  }

  return items.map((item, index) => {
    const suffix = item.host || item.appName || item.url || '-';
    return `${index + 1}. ${item.label} | ${formatDuration(item.totalMs)} | ${item.kind} | ${suffix} | ${item.key}`;
  });
}

function toTextLinesForSessions(sessions) {
  if (!sessions.length) {
    return ['No timeline sessions.'];
  }

  return sessions.map((session, index) => {
    const suffix = session.mediaTitle || session.host || session.appName || session.processName || session.url || '-';
    const liveSuffix = session.isLive ? ' | live' : '';
    return `${index + 1}. ${session.startClock}-${session.endClock} | ${session.label} | ${formatDuration(session.durationMs)} | ${session.kindLabel} | ${suffix} | ${session.key}${liveSuffix}`;
  });
}

function printHelp() {
  process.stdout.write([
    'Usage:',
    '  node src/cli/query.js days [--format json|text] [--data-file <path>]',
    '  node src/cli/query.js top [--range day|week] [--day YYYY-MM-DD|latest] [--limit N] [--format json|text] [--data-file <path>]',
    '  node src/cli/query.js timeline [--day YYYY-MM-DD|latest] [--limit N] [--format json|text] [--data-file <path>]',
    '  node src/cli/query.js search --query <text> [--limit N] [--format json|text] [--data-file <path>]',
    '  node src/cli/query.js detail (--key <itemKey> | --query <text>) [--format json|text] [--data-file <path>]',
    '  node src/cli/query.js snapshot [--format json|text] [--data-file <path>]',
    '  node src/cli/query.js report [--days N] [--format markdown|json|csv] [--output <path>] [--data-file <path>]',
    '',
    'Storage resolution:',
    '  1. --data-file',
    '  2. APP_USAGE_TRACKER_DATA_FILE',
    '  3. --user-data-dir',
    '  4. APP_USAGE_TRACKER_USER_DATA_DIR',
    '  5. Default OS config dir',
    '',
    'Examples:',
    '  npm run query -- top --range day --day latest --limit 5 --format json',
    '  npm run query -- timeline --day latest --limit 20 --format json',
    '  npm run query -- search --query "ChatGPT" --format json',
    '  npm run query -- detail --key service:chatgpt --format json',
    '  npm run query -- report --days 7 --format markdown'
  ].join('\n'));
}

async function runDays(args) {
  const { values } = parseCommandArgs(args);
  if (values.help) {
    printHelp();
    return;
  }

  const format = assertFormat(values);
  const { paths, snapshot } = await loadTracker(values);
  const payload = {
    kind: 'days',
    dataFilePath: paths.dataFilePath,
    latestDayKey: snapshot.meta.latestDayKey,
    availableDays: snapshot.daily.availableDays.map((dayKey) => ({
      dayKey,
      totalMs: Number(snapshot.daily.days?.[dayKey]?.totalMs) || 0,
      totalMinutes: toMinutes(snapshot.daily.days?.[dayKey]?.totalMs)
    }))
  };

  if (format === 'json') {
    process.stdout.write(toJsonOutput(payload));
    return;
  }

  const lines = [
    `Data file: ${payload.dataFilePath}`,
    `Latest day: ${payload.latestDayKey || '-'}`,
    ...payload.availableDays.map((day) => `${day.dayKey} | ${formatDuration(day.totalMs)}`)
  ];
  process.stdout.write(lines.join('\n'));
}

async function runTop(args) {
  const { values } = parseCommandArgs(args, {
    range: { type: 'string' },
    day: { type: 'string' },
    limit: { type: 'string' }
  });

  if (values.help) {
    printHelp();
    return;
  }

  const format = assertFormat(values);
  const range = values.range || 'day';
  const limit = parseLimit(values.limit, 10);

  if (range !== 'day' && range !== 'week') {
    throw new CliError(`Unsupported range "${range}". Use "day" or "week".`);
  }

  const { paths, snapshot } = await loadTracker(values);

  if (range === 'week') {
    const payload = {
      kind: 'top',
      range,
      dataFilePath: paths.dataFilePath,
      dayKeys: snapshot.weekly.dayKeys,
      totalMs: snapshot.weekly.totalMs,
      totalMinutes: toMinutes(snapshot.weekly.totalMs),
      averageMs: snapshot.weekly.averageMs,
      averageMinutes: toMinutes(snapshot.weekly.averageMs),
      limit,
      items: snapshot.weekly.items.slice(0, limit).map(summarizeItem)
    };

    if (format === 'json') {
      process.stdout.write(toJsonOutput(payload));
      return;
    }

    const lines = [
      `Data file: ${payload.dataFilePath}`,
      `Range: week (${payload.dayKeys[0] || '-'} -> ${payload.dayKeys[payload.dayKeys.length - 1] || '-'})`,
      `Total: ${formatDuration(payload.totalMs)} | Average: ${formatDuration(payload.averageMs)}`,
      ...toTextLinesForItems(payload.items)
    ];
    process.stdout.write(lines.join('\n'));
    return;
  }

  const dayKey = resolveDayKey(snapshot, values.day);
  const day = snapshot.daily.days?.[dayKey] || { totalMs: 0, items: [], hourly: new Array(24).fill(0) };
  const payload = {
    kind: 'top',
    range,
    dataFilePath: paths.dataFilePath,
    dayKey,
    totalMs: Number(day.totalMs) || 0,
    totalMinutes: toMinutes(day.totalMs),
    limit,
    items: (day.items || []).slice(0, limit).map(summarizeItem)
  };

  if (format === 'json') {
    process.stdout.write(toJsonOutput(payload));
    return;
  }

  const lines = [
    `Data file: ${payload.dataFilePath}`,
    `Range: day (${payload.dayKey || '-'})`,
    `Total: ${formatDuration(payload.totalMs)}`,
    ...toTextLinesForItems(payload.items)
  ];
  process.stdout.write(lines.join('\n'));
}

async function runTimeline(args) {
  const { values } = parseCommandArgs(args, {
    day: { type: 'string' },
    limit: { type: 'string' }
  });

  if (values.help) {
    printHelp();
    return;
  }

  const format = assertFormat(values);
  const limit = parseLimit(values.limit, 50);
  const { tracker, paths, snapshot, hiddenItemKeySet } = await loadTracker(values);
  const dayKey = resolveDayKey(snapshot, values.day);
  const timeline = tracker.getTimeline(dayKey);
  const visibleSessions = (timeline.sessions || []).filter((session) => !hiddenItemKeySet.has(session.key));
  const totalMs = Number(snapshot.daily.days?.[timeline.dayKey]?.totalMs)
    || visibleSessions.reduce((sum, session) => sum + (Number(session.durationMs) || 0), 0);
  const sessions = visibleSessions.slice(0, limit).map(summarizeSession);
  const payload = {
    kind: 'timeline',
    dataFilePath: paths.dataFilePath,
    dayKey: timeline.dayKey,
    availableDays: timeline.availableDays,
    totalMs,
    totalMinutes: toMinutes(totalMs),
    sessionCount: visibleSessions.length,
    returnedSessionCount: sessions.length,
    limit,
    hasStoredSessions: timeline.hasStoredSessions,
    hasAggregatedData: timeline.hasAggregatedData || totalMs > 0,
    sessions
  };

  if (format === 'json') {
    process.stdout.write(toJsonOutput(payload));
    return;
  }

  const sessionSummary = payload.sessionCount > payload.returnedSessionCount
    ? `${payload.sessionCount} (showing ${payload.returnedSessionCount})`
    : String(payload.sessionCount);
  const lines = [
    `Data file: ${payload.dataFilePath}`,
    `Day: ${payload.dayKey || '-'}`,
    `Total: ${formatDuration(payload.totalMs)}`,
    `Sessions: ${sessionSummary}`
  ];

  if (payload.sessions.length) {
    lines.push(...toTextLinesForSessions(payload.sessions));
  } else if (payload.hasStoredSessions) {
    lines.push('No visible timeline sessions after applying current visibility settings.');
  } else if (payload.hasAggregatedData) {
    lines.push('No stored timeline sessions for this day. Only aggregated totals are available.');
  } else {
    lines.push('No timeline sessions for this day.');
  }

  process.stdout.write(lines.join('\n'));
}

async function runSearch(args) {
  const { values } = parseCommandArgs(args, {
    query: { type: 'string' },
    limit: { type: 'string' }
  });

  if (values.help) {
    printHelp();
    return;
  }

  if (!values.query) {
    throw new CliError('Missing --query. Provide text to search for.');
  }

  const format = assertFormat(values);
  const limit = parseLimit(values.limit, 10);
  const { paths, snapshot } = await loadTracker(values);
  const catalog = buildCatalog(snapshot);
  const matches = searchCatalog(catalog, values.query, limit);
  const payload = {
    kind: 'search',
    dataFilePath: paths.dataFilePath,
    query: values.query,
    totalMatches: matches.length,
    matches: matches.map((match) => ({
      ...summarizeItem(match.item),
      score: match.score,
      dayCount: match.item.dayCount,
      firstSeenDayKey: match.item.firstSeenDayKey,
      lastSeenDayKey: match.item.lastSeenDayKey
    }))
  };

  if (format === 'json') {
    process.stdout.write(toJsonOutput(payload));
    return;
  }

  const lines = [
    `Data file: ${payload.dataFilePath}`,
    `Query: ${payload.query}`,
    ...payload.matches.map((item, index) => (
      `${index + 1}. ${item.label} | ${formatDuration(item.totalMs)} | ${item.kind} | ${item.host || item.appName || '-'} | ${item.key}`
    ))
  ];

  if (!payload.matches.length) {
    lines.push('No matches.');
  }

  process.stdout.write(lines.join('\n'));
}

function getAmbiguousMatchMessage(query, matches) {
  const lines = [
    `Query "${query}" matched multiple items. Use --key with one of these values:`
  ];

  for (const match of matches) {
    lines.push(`- ${match.item.key} (${match.item.label})`);
  }

  return lines.join('\n');
}

async function runDetail(args) {
  const { values } = parseCommandArgs(args, {
    key: { type: 'string' },
    query: { type: 'string' }
  });

  if (values.help) {
    printHelp();
    return;
  }

  if (!values.key && !values.query) {
    throw new CliError('Missing target. Use --key <itemKey> or --query <text>.');
  }

  const format = assertFormat(values);
  const { tracker, paths, snapshot, hiddenItemKeySet } = await loadTracker(values);
  let itemKey = values.key;

  if (!itemKey) {
    const matches = searchCatalog(buildCatalog(snapshot), values.query, 5);
    if (!matches.length) {
      throw new CliError(`No items matched "${values.query}".`);
    }

    const exactMatches = matches.filter((match) => match.score >= 110);
    if (exactMatches.length === 1) {
      itemKey = exactMatches[0].item.key;
    } else if (matches.length === 1) {
      itemKey = matches[0].item.key;
    } else {
      throw new CliError(getAmbiguousMatchMessage(values.query, matches));
    }
  }

  if (hiddenItemKeySet.has(itemKey)) {
    throw new CliError(`Item "${itemKey}" was not found.`);
  }

  const detail = tracker.getItemDetail(itemKey);
  if (!detail) {
    throw new CliError(`Item "${itemKey}" was not found.`);
  }

  const todayTotalMs = (detail.todayHourly || []).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const payload = {
    kind: 'detail',
    dataFilePath: paths.dataFilePath,
    item: {
      ...detail,
      totalMinutes: toMinutes(detail.totalMs),
      todayTotalMs,
      todayTotalMinutes: toMinutes(todayTotalMs),
      averageMinutes: toMinutes(detail.averageMs),
      lastSevenDays: (detail.lastSevenDays || []).map((day) => ({
        ...day,
        totalMinutes: toMinutes(day.totalMs)
      }))
    }
  };

  if (format === 'json') {
    process.stdout.write(toJsonOutput(payload));
    return;
  }

  const lines = [
    `Data file: ${payload.dataFilePath}`,
    `Key: ${payload.item.key}`,
    `Label: ${payload.item.label}`,
    `Kind: ${payload.item.kind}`,
    `Total: ${formatDuration(payload.item.totalMs)}`,
    `Today: ${formatDuration(payload.item.todayTotalMs)}`,
    `Average (last 7 days): ${formatDuration(payload.item.averageMs)}`,
    `App: ${payload.item.appName || '-'}`,
    `Host: ${payload.item.host || '-'}`,
    `URL: ${payload.item.url || '-'}`,
    `Last 7 days: ${(payload.item.lastSevenDays || []).map((day) => `${day.dayKey}=${formatDuration(day.totalMs)}`).join(', ')}`
  ];
  process.stdout.write(lines.join('\n'));
}

async function runSnapshot(args) {
  const { values } = parseCommandArgs(args);
  if (values.help) {
    printHelp();
    return;
  }

  const format = assertFormat(values);
  const { paths, snapshot } = await loadTracker(values);

  if (format === 'json') {
    process.stdout.write(toJsonOutput({
      kind: 'snapshot',
      dataFilePath: paths.dataFilePath,
      snapshot
    }));
    return;
  }

  const lines = [
    `Data file: ${paths.dataFilePath}`,
    `Latest day: ${snapshot.meta.latestDayKey || '-'}`,
    `Current day total: ${formatDuration(snapshot.daily.totalMs)}`,
    `Weekly total: ${formatDuration(snapshot.weekly.totalMs)}`
  ];
  process.stdout.write(lines.join('\n'));
}

function resolveReportFormat(values) {
  if (values.json) {
    return 'json';
  }

  const format = values.format || 'markdown';
  if (format === 'markdown' || format === 'text') {
    return 'markdown';
  }

  if (format === 'json') {
    return 'json';
  }

  if (format === 'csv') {
    return 'csv';
  }

  throw new CliError(`Unsupported format "${format}" for report. Use "markdown", "json" or "csv".`);
}

function percentShare(valueMs, totalMs) {
  if (!totalMs) {
    return 0;
  }

  return Number(((Number(valueMs) || 0) / totalMs * 100).toFixed(1));
}

function getReportDayKeys(snapshot, dayCount) {
  const availableDays = [...(snapshot?.daily?.availableDays || [])].sort();
  return availableDays.slice(-dayCount);
}

function isPlaybackItem(item) {
  return item?.trackingMode === 'playback' || item?.kind === 'playback';
}

function buildReport(snapshot, dayKeys) {
  const days = snapshot?.daily?.days || {};
  const itemMap = new Map();
  const hourlyTotals = new Array(24).fill(0);
  const dailyTotals = [];
  let totalMs = 0;
  let activeDayCount = 0;

  for (const dayKey of dayKeys) {
    const items = (days?.[dayKey]?.items || []).filter(Boolean);
    const dayTotalMs = items.reduce((sum, item) => sum + (Number(item.totalMs) || 0), 0);
    if (dayTotalMs > 0) {
      activeDayCount += 1;
    }
    totalMs += dayTotalMs;

    let topItemKey = null;
    let topItemMs = 0;

    for (const item of items) {
      const itemTotalMs = Number(item.totalMs) || 0;
      const existing = itemMap.get(item.key);
      if (!existing) {
        itemMap.set(item.key, { ...item, totalMs: itemTotalMs, byDay: { [dayKey]: itemTotalMs } });
      } else {
        existing.totalMs += itemTotalMs;
        existing.byDay[dayKey] = itemTotalMs;
      }

      if (itemTotalMs > topItemMs) {
        topItemMs = itemTotalMs;
        topItemKey = item.key;
      }

      (item.hourly || []).forEach((value, index) => {
        hourlyTotals[index] += Number(value) || 0;
      });
    }

    dailyTotals.push({
      dayKey,
      totalMs: dayTotalMs,
      totalMinutes: toMinutes(dayTotalMs),
      itemCount: items.length,
      topItemKey,
      topItemLabel: topItemKey ? (itemMap.get(topItemKey)?.label || '') : '',
      topItemMs
    });
  }

  const items = [...itemMap.values()].sort((left, right) => right.totalMs - left.totalMs);
  const kindSplit = { app: 0, site: 0, service: 0, playback: 0, other: 0 };
  const categoryMap = new Map();

  for (const item of items) {
    if (isPlaybackItem(item)) {
      kindSplit.playback += item.totalMs;
    } else if (item.kind === 'app') {
      kindSplit.app += item.totalMs;
    } else if (item.kind === 'site') {
      kindSplit.site += item.totalMs;
    } else if (item.kind === 'service') {
      kindSplit.service += item.totalMs;
    } else {
      kindSplit.other += item.totalMs;
    }

    const categoryLabel = item.categoryLabel || 'Uncategorized';
    const existingCategory = categoryMap.get(categoryLabel);
    if (!existingCategory) {
      categoryMap.set(categoryLabel, {
        categoryId: item.categoryId || '',
        categoryLabel,
        totalMs: item.totalMs
      });
    } else {
      existingCategory.totalMs += item.totalMs;
    }
  }

  const categories = [...categoryMap.values()].sort((left, right) => right.totalMs - left.totalMs);
  const busiestDay = dailyTotals.reduce(
    (best, day) => (day.totalMs > best.totalMs ? day : best),
    { dayKey: null, totalMs: -1 }
  );
  const maxHourlyMs = Math.max(...hourlyTotals);
  const averageMs = dayKeys.length ? Math.round(totalMs / dayKeys.length) : 0;

  return {
    dayKeys,
    totalMs,
    totalMinutes: toMinutes(totalMs),
    averageMs,
    averageMinutes: toMinutes(averageMs),
    activeDayCount,
    busiestDayKey: busiestDay.totalMs > 0 ? busiestDay.dayKey : null,
    busiestHour: maxHourlyMs > 0 ? hourlyTotals.indexOf(maxHourlyMs) : null,
    hourlyTotals,
    hourlyAverageMinutes: hourlyTotals.map((value) => toMinutes(Math.round(value / Math.max(dayKeys.length, 1)))),
    dailyTotals,
    topItems: items.slice(0, 10).map((item) => ({
      ...summarizeItem(item),
      share: percentShare(item.totalMs, totalMs),
      activeDayCount: Object.keys(item.byDay || {}).length
    })),
    playbackItems: items.filter(isPlaybackItem).slice(0, 10).map((item) => ({
      ...summarizeItem(item),
      share: percentShare(item.totalMs, totalMs)
    })),
    categories: categories.map((category) => ({
      ...category,
      totalMinutes: toMinutes(category.totalMs),
      share: percentShare(category.totalMs, totalMs)
    })),
    kindSplit: Object.fromEntries(
      Object.entries(kindSplit).map(([kind, valueMs]) => [kind, {
        totalMs: valueMs,
        totalMinutes: toMinutes(valueMs),
        share: percentShare(valueMs, totalMs)
      }])
    )
  };
}

function escapeMarkdownCell(value) {
  return String(value).replace(/\|/g, '\\|');
}

function formatPercent(value) {
  return `${value}%`;
}

function renderMarkdownReport(payload) {
  const lines = [];
  const rangeLabel = payload.dayKeys.length
    ? (payload.dayKeys.length === 1
      ? payload.dayKeys[0]
      : `${payload.dayKeys[0]} to ${payload.dayKeys[payload.dayKeys.length - 1]}`)
    : 'no data';

  lines.push(`# Usage Report: ${rangeLabel}`, '');

  if (!payload.dayKeys.length) {
    lines.push('No tracking data available.');
    return lines.join('\n');
  }

  lines.push(
    `- Total: ${formatDuration(payload.totalMs)} | Daily average: ${formatDuration(payload.averageMs)}`,
    `- Active days: ${payload.activeDayCount}/${payload.dayKeys.length} | Busiest day: ${payload.busiestDayKey || '-'}`
  );

  lines.push('', '## Daily Totals', '', '| Day | Total | Items | Top item |', '| --- | --- | --- | --- |');
  for (const day of payload.dailyTotals) {
    lines.push(`| ${day.dayKey} | ${formatDuration(day.totalMs)} | ${day.itemCount} | ${escapeMarkdownCell(day.topItemLabel || '-')} |`);
  }

  lines.push('', '## Top Items', '', '| # | Item | Kind | Time | Share | Days |', '| --- | --- | --- | --- | --- | --- |');
  payload.topItems.forEach((item, index) => {
    lines.push(`| ${index + 1} | ${escapeMarkdownCell(item.label)} | ${item.kind} | ${formatDuration(item.totalMs)} | ${formatPercent(item.share)} | ${item.activeDayCount} |`);
  });

  const splitRows = Object.entries(payload.kindSplit).filter(([, value]) => value.totalMs > 0);
  if (splitRows.length) {
    lines.push('', '## Activity Split', '', '| Kind | Time | Share |', '| --- | --- | --- |');
    for (const [kind, value] of splitRows) {
      lines.push(`| ${kind} | ${formatDuration(value.totalMs)} | ${formatPercent(value.share)} |`);
    }
  }

  lines.push('', '## Categories', '', '| Category | Time | Share |', '| --- | --- | --- |');
  for (const category of payload.categories) {
    lines.push(`| ${escapeMarkdownCell(category.categoryLabel)} | ${formatDuration(category.totalMs)} | ${formatPercent(category.share)} |`);
  }

  if (payload.playbackItems.length) {
    lines.push('', '## Music Playback', '', '| Title | Artist | Time |', '| --- | --- | --- |');
    for (const item of payload.playbackItems) {
      lines.push(`| ${escapeMarkdownCell(item.mediaTitle || item.label)} | ${escapeMarkdownCell(item.mediaArtist || '-')} | ${formatDuration(item.totalMs)} |`);
    }
  }

  lines.push('', '## Hourly Activity', '', '```');
  const maxHourlyMinutes = Math.max(...payload.hourlyAverageMinutes, 1);
  for (let hour = 0; hour < 24; hour += 1) {
    const minutes = payload.hourlyAverageMinutes[hour];
    const barLength = minutes > 0 ? Math.max(1, Math.round((minutes / maxHourlyMinutes) * 24)) : 0;
    const bar = minutes > 0 ? `${formatDuration(minutes * 60000)} ${'#'.repeat(barLength)}` : '';
    lines.push(`${String(hour).padStart(2, '0')}:00 ${bar}`.trimEnd());
  }
  lines.push('```');

  lines.push('', '## Insights', '');
  if (payload.topItems.length) {
    const top = payload.topItems[0];
    lines.push(`- Top item: ${top.label} (${formatDuration(top.totalMs)}, ${formatPercent(top.share)}).`);
  }
  if (payload.busiestHour !== null) {
    lines.push(`- Peak hour: ${String(payload.busiestHour).padStart(2, '0')}:00 (${formatDuration(payload.hourlyAverageMinutes[payload.busiestHour] * 60000)} per day on average).`);
  }
  if (payload.kindSplit.playback.totalMs > 0) {
    lines.push(`- Music playback took ${formatDuration(payload.kindSplit.playback.totalMs)} (${formatPercent(payload.kindSplit.playback.share)}).`);
  }
  if (payload.dailyTotals.length >= 2) {
    const last = payload.dailyTotals[payload.dailyTotals.length - 1];
    const previous = payload.dailyTotals[payload.dailyTotals.length - 2];
    if (previous.totalMs > 0) {
      const delta = Math.round((last.totalMs - previous.totalMs) / previous.totalMs * 100);
      lines.push(`- Trend: ${delta >= 0 ? '+' : ''}${delta}% vs the previous day.`);
    } else if (last.totalMs > 0) {
      lines.push('- Trend: activity started after a zero day.');
    } else {
      lines.push('- Trend: no change (both days recorded no time).');
    }
  }

  return lines.join('\n');
}

function escapeCsvCell(value) {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function renderCsvReport(payload) {
  const rows = [['day', 'total_minutes', 'item_count', 'top_item', 'top_item_minutes']];
  for (const day of payload.dailyTotals) {
    rows.push([
      day.dayKey,
      day.totalMinutes,
      day.itemCount,
      day.topItemLabel || '',
      toMinutes(day.topItemMs)
    ]);
  }

  return `${rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n')}\n`;
}

async function runReport(args) {
  const { values } = parseCommandArgs(args, {
    days: { type: 'string' },
    output: { type: 'string' }
  });

  if (values.help) {
    printHelp();
    return;
  }

  const format = resolveReportFormat(values);
  const dayCount = parsePositiveInteger(values.days, '--days', 7);
  const { paths, snapshot } = await loadTracker(values);
  const dayKeys = getReportDayKeys(snapshot, dayCount);
  const payload = {
    kind: 'report',
    dataFilePath: paths.dataFilePath,
    ...buildReport(snapshot, dayKeys)
  };

  let output;
  if (format === 'json') {
    output = toJsonOutput(payload);
  } else if (format === 'csv') {
    output = renderCsvReport(payload);
  } else {
    output = renderMarkdownReport(payload);
  }

  if (values.output) {
    const outputPath = path.resolve(values.output);
    try {
      await fs.writeFile(outputPath, output, 'utf8');
    } catch (error) {
      throw new CliError(`Failed to write report to "${values.output}": ${error.message}`);
    }
    process.stdout.write(`Report written to ${outputPath}\n`);
    return;
  }

  process.stdout.write(output);
}

async function main(argv = process.argv.slice(2)) {
  const [command = 'help', ...args] = argv;

  switch (command) {
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return;
    case 'days':
      await runDays(args);
      return;
    case 'top':
      await runTop(args);
      return;
    case 'timeline':
      await runTimeline(args);
      return;
    case 'search':
      await runSearch(args);
      return;
    case 'detail':
      await runDetail(args);
      return;
    case 'snapshot':
      await runSnapshot(args);
      return;
    case 'report':
      await runReport(args);
      return;
    default:
      throw new CliError(`Unknown command "${command}". Run "node src/cli/query.js help" for usage.`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof CliError ? error.message : (error && error.stack) || String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}

module.exports = {
  buildCatalog,
  buildReport,
  filterSnapshot,
  getSearchScore,
  main,
  normalizeHiddenItemKeys,
  renderCsvReport,
  renderMarkdownReport,
  resolveStoragePaths,
  searchCatalog
};
