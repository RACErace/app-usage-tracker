const fs = require('fs/promises');
const path = require('path');
const http = require('http');
const { getDomain } = require('tldts');

const DATA_VERSION = 3;
const POLL_INTERVAL_MS = 5000;
const SAVE_DEBOUNCE_MS = 1200;
const BROWSER_EVENT_TTL_MS = 65000;
const MAX_BRIDGE_REQUEST_BYTES = 16 * 1024;
const LOOPBACK_HOST = '127.0.0.1';
const LOOPBACK_PORT = 32123;
const BRIDGE_SHARED_HEADER_NAME = 'x-app-usage-tracker-bridge';
const BRIDGE_SHARED_HEADER_VALUE = 'usage-tracker-extension';
const ALLOWED_BRIDGE_ORIGIN_PREFIXES = ['chrome-extension://', 'moz-extension://'];
let activeWinLoader = null;

const BROWSER_APP_PATTERNS = [
  { family: 'Chrome', names: ['chrome', 'google chrome'] },
  { family: 'Edge', names: ['msedge', 'microsoft edge'] },
  { family: 'Brave', names: ['brave', 'brave browser'] },
  { family: 'Opera', names: ['opera'] },
  { family: 'Firefox', names: ['firefox'] }
];

function padNumber(value) {
  return String(value).padStart(2, '0');
}

function getDayKey(date) {
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`;
}

function sanitizeText(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }

  return value.replace(/\s+/g, ' ').trim() || fallback;
}

function toIdSegment(value) {
  return sanitizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function getColorFromKey(key) {
  const colors = ['#1c8cff', '#22c55e', '#ef4444', '#f59e0b', '#a855f7', '#06b6d4', '#fb7185'];
  const value = parseInt(hashString(key).slice(0, 2), 16);
  return colors[value % colors.length];
}

function ensureArray24(source) {
  const result = new Array(24).fill(0);
  if (Array.isArray(source)) {
    for (let index = 0; index < Math.min(source.length, 24); index += 1) {
      result[index] = Number(source[index]) || 0;
    }
  }

  return result;
}

function normalizeUrl(rawUrl) {
  try {
    const value = new URL(rawUrl);
    value.hash = '';
    return value;
  } catch {
    return null;
  }
}

function isIpHost(hostname) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');
}

function getRootDomain(hostname) {
  const normalized = sanitizeText(hostname).toLowerCase().replace(/\.$/, '');
  if (!normalized) {
    return '';
  }

  if (normalized === 'localhost' || isIpHost(normalized)) {
    return normalized;
  }

  return getDomain(normalized, { allowPrivateDomains: true }) || normalized;
}

function isAllowedBridgeOrigin(origin) {
  const normalizedOrigin = sanitizeText(origin).toLowerCase();
  if (!normalizedOrigin) {
    return false;
  }

  return ALLOWED_BRIDGE_ORIGIN_PREFIXES.some((prefix) => normalizedOrigin.startsWith(prefix));
}

function getBridgeResponseHeaders(origin, extraHeaders = {}) {
  const headers = {
    Vary: 'Origin',
    ...extraHeaders
  };

  if (isAllowedBridgeOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

function hasJsonContentType(contentType) {
  return sanitizeText(contentType).toLowerCase().startsWith('application/json');
}

function isBridgeRequestAuthorized(headers) {
  return isAllowedBridgeOrigin(headers?.origin)
    && headers?.[BRIDGE_SHARED_HEADER_NAME] === BRIDGE_SHARED_HEADER_VALUE
    && hasJsonContentType(headers?.['content-type']);
}

function getDomainDisplayName(hostname) {
  const rootDomain = getRootDomain(hostname);
  if (!rootDomain) {
    return '网页';
  }

  const [firstLabel] = rootDomain.split('.');
  return sanitizeText(firstLabel, rootDomain).toLowerCase();
}

function normalizeComparableToken(value) {
  return sanitizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '');
}

function getExecutableName(executablePath) {
  const normalized = sanitizeText(executablePath);
  if (!normalized) {
    return '';
  }

  try {
    return path.basename(normalized).toLowerCase();
  } catch {
    const segments = normalized.split(/[\\/]/);
    return sanitizeText(segments[segments.length - 1]).toLowerCase();
  }
}

const SERVICE_PROFILES = [
  {
    id: 'chatgpt',
    displayLabel: 'ChatGPT',
    domains: ['chatgpt.com'],
    appNames: ['chatgpt', 'openai chatgpt'],
    executables: ['chatgpt.exe']
  },
  {
    id: 'bilibili',
    displayLabel: 'bilibili',
    domains: ['bilibili.com'],
    appNames: ['bilibili', '哔哩哔哩'],
    executables: ['bilibili.exe']
  }
].map((profile) => ({
  ...profile,
  appTokens: profile.appNames.map((value) => normalizeComparableToken(value)).filter(Boolean),
  executableTokens: profile.executables.map((value) => normalizeComparableToken(value)).filter(Boolean)
}));

function getBrowserFamily(appName) {
  const normalized = sanitizeText(appName).toLowerCase();
  const match = BROWSER_APP_PATTERNS.find((pattern) => pattern.names.includes(normalized));
  return match ? match.family : null;
}

function isBrowserApp(appName) {
  return Boolean(getBrowserFamily(appName));
}

function findServiceProfile(entry) {
  if (!entry) {
    return null;
  }

  const normalizedUrl = normalizeUrl(entry.url || '');
  const rootDomain = getRootDomain(entry.host || normalizedUrl?.hostname || '');
  const tokens = new Set([
    normalizeComparableToken(entry.appName),
    normalizeComparableToken(entry.label),
    normalizeComparableToken(getExecutableName(entry.executablePath))
  ].filter(Boolean));

  return SERVICE_PROFILES.find((profile) => {
    if (rootDomain && profile.domains.includes(rootDomain)) {
      return true;
    }

    return profile.appTokens.some((token) => tokens.has(token))
      || profile.executableTokens.some((token) => tokens.has(token));
  }) || null;
}

function canonicalizeEntry(entry) {
  const profile = findServiceProfile(entry);
  if (!profile) {
    return entry;
  }

  const key = `service:${profile.id}`;
  const isBrowserBacked = isBrowserApp(entry.appName) || Boolean(entry.browserFamily);
  return {
    ...entry,
    key,
    kind: 'service',
    label: profile.displayLabel,
    appName: profile.displayLabel,
    host: sanitizeText(entry.host, profile.domains[0] || ''),
    executablePath: isBrowserBacked ? '' : sanitizeText(entry.executablePath),
    color: getColorFromKey(key)
  };
}

function cloneItem(item) {
  return {
    ...item,
    hourly: [...item.hourly]
  };
}

async function getActiveWindow() {
  if (!activeWinLoader) {
    activeWinLoader = import('active-win').then((module) => {
      if (typeof module.activeWindow === 'function') {
        return module.activeWindow;
      }

      if (module.default && typeof module.default.activeWindow === 'function') {
        return module.default.activeWindow;
      }

      if (typeof module.default === 'function') {
        return module.default;
      }

      throw new Error('active-win 导出格式不符合预期');
    });
  }

  const resolver = await activeWinLoader;
  return resolver();
}

class BrowserEventCache {
  constructor() {
    this.events = new Map();
  }

  upsert(payload) {
    const normalizedUrl = normalizeUrl(payload.url);
    if (!normalizedUrl) {
      return;
    }

    const browserFamily = sanitizeText(payload.browserFamily, 'Chrome');
    const key = browserFamily.toLowerCase();
    this.events.set(key, {
      browserFamily,
      pageTitle: sanitizeText(payload.pageTitle, normalizedUrl.hostname),
      url: normalizedUrl.toString(),
      host: normalizedUrl.hostname,
      rootDomain: getRootDomain(normalizedUrl.hostname),
      displayName: getDomainDisplayName(normalizedUrl.hostname),
      path: normalizedUrl.pathname || '/',
      receivedAt: Date.now()
    });
  }

  getFresh(browserFamily) {
    const key = sanitizeText(browserFamily).toLowerCase();
    const event = this.events.get(key);
    if (!event) {
      return null;
    }

    if (Date.now() - event.receivedAt > BROWSER_EVENT_TTL_MS) {
      this.events.delete(key);
      return null;
    }

    return event;
  }
}

function createEmptyData() {
  return { version: DATA_VERSION, days: {} };
}

function cloneStoredItem(item) {
  return {
    ...item,
    hourly: ensureArray24(item.hourly),
    totalMs: Number(item.totalMs) || 0,
    lastSeenAt: Number(item.lastSeenAt) || 0
  };
}

function isBrowserUsageItem(item) {
  if (!item) {
    return false;
  }

  if (item.kind === 'page' || item.kind === 'site') {
    return true;
  }

  return Boolean(item.browserFamily || isBrowserApp(item.appName || item.label || ''));
}

function hasWebsiteMetadata(item) {
  return Boolean(sanitizeText(item.host) || sanitizeText(item.url) || sanitizeText(item.pageTitle));
}

function buildSiteEntry(item, inferredHost = '') {
  const normalizedUrl = normalizeUrl(item.url || '');
  const rawHost = sanitizeText(inferredHost || item.host || normalizedUrl?.hostname || '');
  const rootDomain = getRootDomain(rawHost);
  if (!rootDomain) {
    return null;
  }

  const key = `site:${hashString(rootDomain)}`;
  const pageTitle = sanitizeText(item.pageTitle || item.label || item.subtitle || '');
  return {
    key,
    kind: 'site',
    label: getDomainDisplayName(rootDomain),
    subtitle: pageTitle || rootDomain,
    appName: sanitizeText(item.appName, item.label || 'Browser'),
    browserFamily: sanitizeText(item.browserFamily, getBrowserFamily(item.appName || item.label || '') || ''),
    pageTitle,
    windowTitle: sanitizeText(item.windowTitle, pageTitle || item.subtitle || rootDomain),
    url: sanitizeText(item.url),
    host: rootDomain,
    path: sanitizeText(item.path, normalizedUrl?.pathname || '/'),
    executablePath: sanitizeText(item.executablePath),
    totalMs: Number(item.totalMs) || 0,
    hourly: ensureArray24(item.hourly),
    color: getColorFromKey(key),
    lastSeenAt: Number(item.lastSeenAt) || 0
  };
}

function mergeStoredItems(target, source) {
  target.totalMs += Number(source.totalMs) || 0;
  target.hourly = target.hourly.map((value, index) => value + ((source.hourly && source.hourly[index]) || 0));

  const sourceSeenAt = Number(source.lastSeenAt) || 0;
  const targetSeenAt = Number(target.lastSeenAt) || 0;
  if (sourceSeenAt >= targetSeenAt) {
    target.label = source.label || target.label;
    target.subtitle = source.subtitle || target.subtitle;
    target.appName = source.appName || target.appName;
    target.browserFamily = source.browserFamily || target.browserFamily;
    target.pageTitle = source.pageTitle || target.pageTitle;
    target.windowTitle = source.windowTitle || target.windowTitle;
    target.url = source.url || target.url;
    target.host = source.host || target.host;
    target.path = source.path || target.path;
    target.executablePath = source.executablePath || target.executablePath;
    target.lastSeenAt = sourceSeenAt;
  }
}

function mergeIntoMap(map, item) {
  const existing = map[item.key];
  if (!existing) {
    map[item.key] = cloneStoredItem(item);
    return;
  }

  mergeStoredItems(existing, item);
}

function inferSiteHostFromTitle(item, siteCandidates) {
  const title = sanitizeText(item.windowTitle || item.subtitle || '').toLowerCase();
  if (!title || !siteCandidates.length) {
    return '';
  }

  let bestCandidate = null;
  let bestScore = 0;

  for (const candidate of siteCandidates) {
    const rootDomain = sanitizeText(candidate.host).toLowerCase();
    const displayName = getDomainDisplayName(rootDomain).toLowerCase();
    const aliases = [rootDomain, displayName, sanitizeText(candidate.label).toLowerCase()].filter(Boolean);
    let score = 0;

    for (const alias of aliases) {
      if (!alias) {
        continue;
      }

      if (title.includes(alias)) {
        score = Math.max(score, alias === rootDomain ? 3 : 2);
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  return bestCandidate ? bestCandidate.host : '';
}

function migrateDay(day) {
  const sourceItems = Object.values(day?.items || {}).map((item) => cloneStoredItem(item));
  const nextItems = {};
  let changed = false;

  for (const item of sourceItems) {
    if (isBrowserUsageItem(item) && hasWebsiteMetadata(item)) {
      const siteItem = buildSiteEntry(item);
      if (siteItem) {
        const canonicalItem = canonicalizeEntry(siteItem);
        mergeIntoMap(nextItems, canonicalItem);
        if (item.key !== canonicalItem.key || item.kind !== canonicalItem.kind || item.host !== canonicalItem.host || item.label !== canonicalItem.label) {
          changed = true;
        }
        continue;
      }
    }

    const canonicalItem = canonicalizeEntry(item);
    mergeIntoMap(nextItems, canonicalItem);
    if (canonicalItem.key !== item.key || canonicalItem.kind !== item.kind || canonicalItem.label !== item.label) {
      changed = true;
    }
  }

  const siteCandidates = Object.values(nextItems).filter((item) => Boolean(item.host));
  for (const item of Object.values(nextItems)) {
    if (!isBrowserUsageItem(item) || item.kind !== 'app' || hasWebsiteMetadata(item)) {
      continue;
    }

    const inferredHost = inferSiteHostFromTitle(item, siteCandidates.filter((candidate) => {
      if (item.browserFamily && candidate.browserFamily) {
        return item.browserFamily === candidate.browserFamily;
      }

      return true;
    }));

    if (!inferredHost) {
      continue;
    }

    const siteItem = buildSiteEntry(item, inferredHost);
    if (!siteItem) {
      continue;
    }

    const canonicalItem = canonicalizeEntry(siteItem);

    delete nextItems[item.key];
    mergeIntoMap(nextItems, canonicalItem);
    changed = true;
  }

  const totalMs = Object.values(nextItems).reduce((sum, item) => sum + (Number(item.totalMs) || 0), 0);
  if ((Number(day?.totalMs) || 0) !== totalMs) {
    changed = true;
  }

  return {
    totalMs,
    items: nextItems,
    changed
  };
}

function migrateUsageData(rawData) {
  const parsed = rawData && typeof rawData === 'object' ? rawData : {};
  const result = createEmptyData();
  let changed = Number(parsed.version) !== DATA_VERSION;

  for (const [dayKey, day] of Object.entries(parsed.days || {})) {
    const migratedDay = migrateDay(day);
    result.days[dayKey] = {
      totalMs: migratedDay.totalMs,
      items: migratedDay.items
    };
    changed ||= migratedDay.changed;
  }

  return { data: result, changed };
}

async function migrateUsageDataFile(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return { data: createEmptyData(), changed: false };
  }

  const migrated = migrateUsageData(parsed);
  if (migrated.changed) {
    await fs.writeFile(filePath, JSON.stringify(migrated.data, null, 2), 'utf8');
  }

  return migrated;
}

class UsageTracker {
  constructor({ userDataPath, onDataChanged }) {
    this.userDataPath = userDataPath;
    this.onDataChanged = onDataChanged;
    this.dataFilePath = path.join(userDataPath, 'usage-data.json');
    this.data = createEmptyData();
    this.currentEntry = null;
    this.timer = null;
    this.saveTimer = null;
    this.httpServer = null;
    this.browserEvents = new BrowserEventCache();
    this.serializedDayCache = new Map();
    this.sortedDayKeysCache = [];
    this.sortedDayKeysDirty = true;
  }

  async init() {
    await this.load();
    await this.startBrowserBridge();
    await this.pollActiveWindow();
    this.timer = setInterval(() => {
      this.pollActiveWindow().catch(() => {});
    }, POLL_INTERVAL_MS);
  }

  async dispose() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.commitCurrentEntry(Date.now());
    if (this.httpServer) {
      await new Promise((resolve) => this.httpServer.close(resolve));
      this.httpServer = null;
    }

    await this.save();
  }

  async load() {
    try {
      const fileContent = await fs.readFile(this.dataFilePath, 'utf8');
      const parsed = JSON.parse(fileContent);
      const migrated = migrateUsageData(parsed);
      this.data = migrated.data;
      this.resetDerivedCaches();
      if (migrated.changed) {
        await this.save();
      }
    } catch {
      this.data = createEmptyData();
      this.resetDerivedCaches();
    }
  }

  scheduleSave() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    this.saveTimer = setTimeout(() => {
      this.save().catch(() => {});
    }, SAVE_DEBOUNCE_MS);
  }

  async save() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    await fs.mkdir(this.userDataPath, { recursive: true });
    await fs.writeFile(this.dataFilePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  async startBrowserBridge() {
    this.httpServer = http.createServer((request, response) => {
      const origin = request.headers.origin;
      const writeJson = (statusCode, payload, extraHeaders = {}) => {
        response.writeHead(statusCode, getBridgeResponseHeaders(origin, {
          'Content-Type': 'application/json',
          ...extraHeaders
        }));
        response.end(JSON.stringify(payload));
      };

      if (request.method === 'OPTIONS') {
        if (!isAllowedBridgeOrigin(origin)) {
          response.writeHead(403, { Vary: 'Origin' });
          response.end();
          return;
        }

        response.writeHead(204, {
          ...getBridgeResponseHeaders(origin),
          'Access-Control-Allow-Headers': `Content-Type, ${BRIDGE_SHARED_HEADER_NAME}`,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Max-Age': '600'
        });
        response.end();
        return;
      }

      if (request.method !== 'POST' || request.url !== '/v1/browser-event') {
        writeJson(404, { ok: false });
        return;
      }

      if (!isBridgeRequestAuthorized(request.headers)) {
        writeJson(403, { ok: false });
        request.resume();
        return;
      }

      const contentLength = Number(request.headers['content-length']);
      if (Number.isFinite(contentLength) && contentLength > MAX_BRIDGE_REQUEST_BYTES) {
        writeJson(413, { ok: false });
        request.resume();
        return;
      }

      const chunks = [];
      let receivedBytes = 0;
      let completed = false;

      request.on('data', (chunk) => {
        if (completed) {
          return;
        }

        receivedBytes += chunk.length;
        if (receivedBytes > MAX_BRIDGE_REQUEST_BYTES) {
          completed = true;
          writeJson(413, { ok: false });
          request.destroy();
          return;
        }

        chunks.push(chunk);
      });

      request.on('error', () => {
        if (completed) {
          return;
        }

        completed = true;
        writeJson(400, { ok: false });
      });

      request.on('end', () => {
        if (completed) {
          return;
        }

        completed = true;
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const payload = JSON.parse(body);
          this.browserEvents.upsert(payload);
          writeJson(200, { ok: true });
        } catch {
          writeJson(400, { ok: false });
        }
      });
    });

    await new Promise((resolve, reject) => {
      this.httpServer.once('error', reject);
      this.httpServer.listen(LOOPBACK_PORT, LOOPBACK_HOST, () => {
        this.httpServer.removeListener('error', reject);
        resolve();
      });
    });
  }

  async pollActiveWindow() {
    const now = Date.now();
    this.commitCurrentEntry(now);

    const activeWindow = await getActiveWindow();
    const normalized = this.normalizeWindow(activeWindow, now);
    this.currentEntry = normalized;

    if (normalized) {
      this.emitDataChanged();
    }
  }

  normalizeWindow(activeWindow, now) {
    if (!activeWindow || !activeWindow.owner) {
      return null;
    }

    const appName = sanitizeText(activeWindow.owner.name, 'Unknown App');
    const windowTitle = sanitizeText(activeWindow.title, appName);
    const executablePath = sanitizeText(activeWindow.owner.path || '');
    const browserFamily = getBrowserFamily(appName);

    if (browserFamily) {
      const browserEvent = this.browserEvents.getFresh(browserFamily);
      if (browserEvent) {
        const groupedDomain = browserEvent.rootDomain || browserEvent.host;
        const pageKey = `site:${hashString(groupedDomain)}`;
        return canonicalizeEntry({
          key: pageKey,
          kind: 'site',
          appName,
          browserFamily,
          pageTitle: browserEvent.pageTitle,
          windowTitle,
          url: browserEvent.url,
          host: groupedDomain,
          path: browserEvent.path,
          label: browserEvent.displayName || groupedDomain,
          subtitle: browserEvent.pageTitle || groupedDomain,
          color: getColorFromKey(pageKey),
          startedAt: now,
          lastSeenAt: now,
          executablePath
        });
      }
    }

    const appKey = `app:${toIdSegment(appName)}:${hashString(`${appName}|${executablePath}`)}`;
    return canonicalizeEntry({
      key: appKey,
      kind: 'app',
      appName,
      browserFamily: browserFamily || null,
      pageTitle: '',
      windowTitle,
      url: '',
      host: '',
      path: '',
      label: appName,
      subtitle: windowTitle,
      color: getColorFromKey(appKey),
      startedAt: now,
      lastSeenAt: now,
      executablePath
    });
  }

  commitCurrentEntry(now) {
    if (!this.currentEntry) {
      return;
    }

    const startedAt = this.currentEntry.lastSeenAt || this.currentEntry.startedAt;
    if (!startedAt || now <= startedAt) {
      this.currentEntry.lastSeenAt = now;
      return;
    }

    this.allocateDuration(this.currentEntry, startedAt, now);
    this.currentEntry.lastSeenAt = now;
    this.scheduleSave();
  }

  allocateDuration(entry, startTimestamp, endTimestamp) {
    let cursor = startTimestamp;
    while (cursor < endTimestamp) {
      const currentDate = new Date(cursor);
      const dayBoundary = new Date(currentDate);
      dayBoundary.setHours(24, 0, 0, 0);
      const sliceEnd = Math.min(endTimestamp, dayBoundary.getTime());
      const durationMs = sliceEnd - cursor;
      this.applyDuration(entry, currentDate, durationMs);
      cursor = sliceEnd;
    }
  }

  applyDuration(entry, date, durationMs) {
    const dayKey = getDayKey(date);
    const day = this.ensureDay(dayKey);
    const item = this.ensureItem(day, entry);

    day.totalMs += durationMs;
    item.totalMs += durationMs;
    item.lastSeenAt = Date.now();
    this.serializedDayCache.delete(dayKey);

    let remaining = durationMs;
    let cursor = new Date(date);

    while (remaining > 0) {
      const hour = cursor.getHours();
      const nextHour = new Date(cursor);
      nextHour.setMinutes(60, 0, 0);
      const sliceMs = Math.min(remaining, nextHour.getTime() - cursor.getTime());
      item.hourly[hour] += sliceMs;
      remaining -= sliceMs;
      cursor = nextHour;
    }
  }

  ensureDay(dayKey) {
    if (!this.data.days[dayKey]) {
      this.data.days[dayKey] = { totalMs: 0, items: {} };
      this.sortedDayKeysDirty = true;
    }

    return this.data.days[dayKey];
  }

  ensureItem(day, entry) {
    if (!day.items[entry.key]) {
      day.items[entry.key] = {
        key: entry.key,
        kind: entry.kind,
        label: entry.label,
        subtitle: entry.subtitle,
        appName: entry.appName,
        browserFamily: entry.browserFamily,
        pageTitle: entry.pageTitle,
        windowTitle: entry.windowTitle,
        url: entry.url,
        host: entry.host,
        path: entry.path,
        executablePath: entry.executablePath,
        totalMs: 0,
        hourly: new Array(24).fill(0),
        color: entry.color,
        lastSeenAt: Date.now()
      };
    }

    const item = day.items[entry.key];
    item.label = entry.label;
    item.subtitle = entry.subtitle;
    item.appName = entry.appName;
    item.browserFamily = entry.browserFamily;
    item.pageTitle = entry.pageTitle;
    item.windowTitle = entry.windowTitle;
    item.url = entry.url;
    item.host = entry.host;
    item.path = entry.path;
    item.executablePath = entry.executablePath;
    item.color = entry.color;
    return item;
  }

  getSortedDayKeys() {
    if (this.sortedDayKeysDirty) {
      this.sortedDayKeysCache = Object.keys(this.data.days).sort();
      this.sortedDayKeysDirty = false;
    }

    return this.sortedDayKeysCache;
  }

  resetDerivedCaches() {
    this.serializedDayCache.clear();
    this.sortedDayKeysCache = [];
    this.sortedDayKeysDirty = true;
  }

  getSerializedDay(dayKey) {
    if (this.serializedDayCache.has(dayKey)) {
      return this.serializedDayCache.get(dayKey);
    }

    const day = this.data.days[dayKey] || { totalMs: 0, items: {} };
    const serialized = {
      totalMs: day.totalMs,
      hourly: this.mergeDayHourly(day),
      items: Object.values(day.items)
        .sort((left, right) => right.totalMs - left.totalMs)
        .map((item) => cloneItem(item))
    };

    this.serializedDayCache.set(dayKey, serialized);
    return serialized;
  }

  getSnapshot() {
    const dayKeys = this.getSortedDayKeys();
    const latestDayKey = dayKeys[dayKeys.length - 1] || getDayKey(new Date());
    const recentDays = dayKeys.slice(-7);
    const serializedDays = Object.fromEntries(
      dayKeys.map((dayKey) => [dayKey, this.getSerializedDay(dayKey)])
    );
    const currentDay = serializedDays[latestDayKey] || { totalMs: 0, hourly: new Array(24).fill(0), items: [] };

    const weeklyMap = new Map();
    let weeklyTotalMs = 0;

    for (const dayKey of recentDays) {
      const day = serializedDays[dayKey];
      weeklyTotalMs += day.totalMs;
      for (const item of day.items) {
        const existing = weeklyMap.get(item.key);
        if (!existing) {
          weeklyMap.set(item.key, {
            ...cloneItem(item),
            totalMs: item.totalMs,
            byDay: { [dayKey]: item.totalMs }
          });
        } else {
          existing.totalMs += item.totalMs;
          existing.byDay[dayKey] = item.totalMs;
          existing.hourly = existing.hourly.map((value, index) => value + item.hourly[index]);
          existing.label = item.label;
          existing.subtitle = item.subtitle;
          existing.url = item.url || existing.url;
          existing.host = item.host || existing.host;
          existing.pageTitle = item.pageTitle || existing.pageTitle;
          existing.appName = item.appName || existing.appName;
        }
      }
    }
    const weeklyItems = [...weeklyMap.values()].sort((left, right) => right.totalMs - left.totalMs);

    return {
      meta: {
        latestDayKey,
        currentEntryKey: this.currentEntry ? this.currentEntry.key : null,
        bridgeUrl: `http://${LOOPBACK_HOST}:${LOOPBACK_PORT}/v1/browser-event`
      },
      daily: {
        availableDays: dayKeys,
        days: serializedDays,
        selectedDayKey: latestDayKey,
        totalMs: currentDay.totalMs,
        hourly: [...currentDay.hourly],
        items: currentDay.items
      },
      weekly: {
        dayKeys: recentDays,
        totalMs: weeklyTotalMs,
        averageMs: recentDays.length ? Math.round(weeklyTotalMs / recentDays.length) : 0,
        dailyTotals: recentDays.map((dayKey) => ({ dayKey, totalMs: serializedDays[dayKey].totalMs })),
        items: weeklyItems
      }
    };
  }

  mergeDayHourly(day) {
    const hourly = new Array(24).fill(0);
    for (const item of Object.values(day.items)) {
      for (let index = 0; index < 24; index += 1) {
        hourly[index] += item.hourly[index];
      }
    }

    return hourly;
  }

  getItemDetail(itemKey) {
    const dayKeys = this.getSortedDayKeys();
    const perDay = [];
    const currentDayKey = dayKeys[dayKeys.length - 1] || getDayKey(new Date());
    let latestItem = null;
    let todayHourly = new Array(24).fill(0);

    for (const dayKey of dayKeys) {
      const item = this.data.days[dayKey].items[itemKey];
      if (item) {
        latestItem = item;
        perDay.push({ dayKey, totalMs: item.totalMs });
        if (dayKey === currentDayKey) {
          todayHourly = [...item.hourly];
        }
      }
    }

    if (!latestItem) {
      return null;
    }

    const lastSevenDays = perDay.slice(-7);
    const totalMs = perDay.reduce((sum, day) => sum + day.totalMs, 0);

    return {
      ...cloneItem(latestItem),
      totalMs,
      todayHourly,
      lastSevenDays,
      averageMs: lastSevenDays.length
        ? Math.round(lastSevenDays.reduce((sum, day) => sum + day.totalMs, 0) / lastSevenDays.length)
        : 0
    };
  }

  async emitDataChanged() {
    if (typeof this.onDataChanged === 'function') {
      await this.onDataChanged();
    }
  }
}

module.exports = {
  UsageTracker,
  migrateUsageData,
  migrateUsageDataFile,
  LOOPBACK_PORT,
  LOOPBACK_HOST,
  BRIDGE_SHARED_HEADER_NAME,
  BRIDGE_SHARED_HEADER_VALUE,
  MAX_BRIDGE_REQUEST_BYTES,
  __testables: {
    getDayKey,
    getRootDomain,
    isAllowedBridgeOrigin,
    isBridgeRequestAuthorized
  }
};
