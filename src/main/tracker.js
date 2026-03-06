const fs = require('fs/promises');
const path = require('path');
const http = require('http');

const POLL_INTERVAL_MS = 5000;
const SAVE_DEBOUNCE_MS = 1200;
const BROWSER_EVENT_TTL_MS = 20000;
const LOOPBACK_HOST = '127.0.0.1';
const LOOPBACK_PORT = 32123;
let activeWinLoader = null;

const BROWSER_APP_PATTERNS = [
  { family: 'Chrome', names: ['chrome', 'google chrome'] },
  { family: 'Edge', names: ['msedge', 'microsoft edge'] },
  { family: 'Brave', names: ['brave', 'brave browser'] },
  { family: 'Opera', names: ['opera'] },
  { family: 'Firefox', names: ['firefox'] }
];

function getDayKey(date) {
  return date.toISOString().slice(0, 10);
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

function getBrowserFamily(appName) {
  const normalized = sanitizeText(appName).toLowerCase();
  const match = BROWSER_APP_PATTERNS.find((pattern) => pattern.names.includes(normalized));
  return match ? match.family : null;
}

function isBrowserApp(appName) {
  return Boolean(getBrowserFamily(appName));
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

class UsageTracker {
  constructor({ userDataPath, onDataChanged }) {
    this.userDataPath = userDataPath;
    this.onDataChanged = onDataChanged;
    this.dataFilePath = path.join(userDataPath, 'usage-data.json');
    this.data = { version: 1, days: {} };
    this.currentEntry = null;
    this.timer = null;
    this.saveTimer = null;
    this.httpServer = null;
    this.browserEvents = new BrowserEventCache();
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
      this.data = {
        version: 1,
        days: Object.fromEntries(
          Object.entries(parsed.days || {}).map(([dayKey, day]) => {
            const items = Object.fromEntries(
              Object.entries(day.items || {}).map(([itemKey, item]) => [
                itemKey,
                {
                  ...item,
                  hourly: ensureArray24(item.hourly)
                }
              ])
            );

            return [dayKey, { ...day, items }];
          })
        )
      };
    } catch {
      this.data = { version: 1, days: {} };
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
    this.httpServer = http.createServer(async (request, response) => {
      if (request.method === 'OPTIONS') {
        response.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'POST, OPTIONS'
        });
        response.end();
        return;
      }

      if (request.method !== 'POST' || request.url !== '/v1/browser-event') {
        response.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        response.end(JSON.stringify({ ok: false }));
        return;
      }

      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', async () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const payload = JSON.parse(body);
          this.browserEvents.upsert(payload);
          response.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          response.end(JSON.stringify({ ok: true }));
        } catch {
          response.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          response.end(JSON.stringify({ ok: false }));
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
        const pageKey = `page:${toIdSegment(browserFamily)}:${hashString(browserEvent.url)}`;
        return {
          key: pageKey,
          kind: 'page',
          appName,
          browserFamily,
          pageTitle: browserEvent.pageTitle,
          windowTitle,
          url: browserEvent.url,
          host: browserEvent.host,
          path: browserEvent.path,
          label: browserEvent.pageTitle || browserEvent.host,
          subtitle: browserEvent.host,
          color: getColorFromKey(pageKey),
          startedAt: now,
          lastSeenAt: now,
          executablePath
        };
      }
    }

    const appKey = `app:${toIdSegment(appName)}:${hashString(`${appName}|${executablePath}`)}`;
    return {
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
    };
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
    return Object.keys(this.data.days).sort();
  }

  getSnapshot() {
    const dayKeys = this.getSortedDayKeys();
    const latestDayKey = dayKeys[dayKeys.length - 1] || getDayKey(new Date());
    const currentDay = this.data.days[latestDayKey] || { totalMs: 0, items: {} };
    const recentDays = dayKeys.slice(-7);
    const serializedDays = Object.fromEntries(
      dayKeys.map((dayKey) => {
        const day = this.data.days[dayKey];
        const items = Object.values(day.items).sort((left, right) => right.totalMs - left.totalMs).map((item) => cloneItem(item));
        return [dayKey, { totalMs: day.totalMs, hourly: this.mergeDayHourly(day), items }];
      })
    );

    const weeklyMap = new Map();
    let weeklyTotalMs = 0;

    for (const dayKey of recentDays) {
      const day = this.data.days[dayKey];
      weeklyTotalMs += day.totalMs;
      for (const item of Object.values(day.items)) {
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
        }
      }
    }

    const currentItems = Object.values(currentDay.items).sort((left, right) => right.totalMs - left.totalMs);
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
        hourly: this.mergeDayHourly(currentDay),
        items: currentItems
      },
      weekly: {
        dayKeys: recentDays,
        totalMs: weeklyTotalMs,
        averageMs: recentDays.length ? Math.round(weeklyTotalMs / recentDays.length) : 0,
        dailyTotals: recentDays.map((dayKey) => ({ dayKey, totalMs: this.data.days[dayKey].totalMs })),
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
  LOOPBACK_PORT,
  LOOPBACK_HOST
};