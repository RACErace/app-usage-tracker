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
  const tracker = new UsageTracker({
    userDataPath: paths.userDataPath,
    onDataChanged: null
  });

  tracker.dataFilePath = paths.dataFilePath;
  await tracker.load();

  const settings = await loadSettings(paths);
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
      hiddenItemKeys: normalizeHiddenItemKeys(parsed?.hiddenItemKeys)
    };
  } catch {
    return {
      hiddenItemKeys: []
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

function printHelp() {
  process.stdout.write([
    'Usage:',
    '  node src/cli/query.js days [--format json|text] [--data-file <path>]',
    '  node src/cli/query.js top [--range day|week] [--day YYYY-MM-DD|latest] [--limit N] [--format json|text] [--data-file <path>]',
    '  node src/cli/query.js search --query <text> [--limit N] [--format json|text] [--data-file <path>]',
    '  node src/cli/query.js detail (--key <itemKey> | --query <text>) [--format json|text] [--data-file <path>]',
    '  node src/cli/query.js snapshot [--format json|text] [--data-file <path>]',
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
    '  npm run query -- search --query "ChatGPT" --format json',
    '  npm run query -- detail --key service:chatgpt --format json'
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
    case 'search':
      await runSearch(args);
      return;
    case 'detail':
      await runDetail(args);
      return;
    case 'snapshot':
      await runSnapshot(args);
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
  filterSnapshot,
  getSearchScore,
  main,
  normalizeHiddenItemKeys,
  resolveStoragePaths,
  searchCatalog
};
