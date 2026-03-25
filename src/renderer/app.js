const DEFAULT_BACKUP_STATUS = Object.freeze({
  tone: 'neutral',
  text: '可将当前统计数据与设置导出为 JSON 备份文件，也支持导入旧的 usage-data.json。'
});

const state = {
  snapshot: null,
  settings: null,
  selectedRange: 'daily',
  selectedDayKey: null,
  detailItemKey: null,
  detail: null,
  activeScreen: 'overview',
  iconCache: new Map(),
  unsubscribe: null,
  updatingHiddenItems: false,
  updatingCloseAction: false,
  updatingAutoBackup: false,
  backupBusy: false,
  backupBusyAction: '',
  backupStatus: { ...DEFAULT_BACKUP_STATUS }
};

const elements = {
  topbar: document.querySelector('.topbar'),
  tabRow: document.getElementById('range-tabs'),
  screenTitle: document.getElementById('screen-title'),
  overviewScreen: document.getElementById('overview-screen'),
  detailScreen: document.getElementById('detail-screen'),
  settingsScreen: document.getElementById('settings-screen'),
  settingsButton: document.getElementById('settings-button'),
  rangeTabs: [...document.querySelectorAll('.range-tab')],
  previousDay: document.getElementById('previous-day'),
  nextDay: document.getElementById('next-day'),
  dateLabel: document.getElementById('date-label'),
  browserExtensionWarning: document.getElementById('browser-extension-warning'),
  browserExtensionWarningText: document.getElementById('browser-extension-warning-text'),
  chartSectionTitle: document.getElementById('chart-section-title'),
  summaryDuration: document.getElementById('summary-duration'),
  summarySubtitle: document.getElementById('summary-subtitle'),
  chartCanvas: document.getElementById('usage-chart'),
  chartTooltip: document.getElementById('chart-tooltip'),
  rankingList: document.getElementById('ranking-list'),
  settingsBridgeUrlText: document.getElementById('settings-bridge-url-text'),
  browserExtensionStatusDot: document.getElementById('browser-extension-status-dot'),
  browserExtensionStatusText: document.getElementById('browser-extension-status-text'),
  browserExtensionStatusDetail: document.getElementById('browser-extension-status-detail'),
  refreshButton: document.getElementById('refresh-button'),
  backButton: document.getElementById('back-button'),
  detailAvatar: document.getElementById('detail-avatar'),
  detailTitle: document.getElementById('detail-title'),
  detailSubtitle: document.getElementById('detail-subtitle'),
  detailTodayDuration: document.getElementById('detail-today-duration'),
  detailWeekAverage: document.getElementById('detail-week-average'),
  detailWeekTotal: document.getElementById('detail-week-total'),
  detailDayChart: document.getElementById('detail-day-chart'),
  detailDayTooltip: document.getElementById('detail-day-tooltip'),
  detailWeekChart: document.getElementById('detail-week-chart'),
  detailWeekTooltip: document.getElementById('detail-week-tooltip'),
  detailMeta: document.getElementById('detail-meta'),
  autoLaunchStatus: document.getElementById('auto-launch-status'),
  autoLaunchToggle: document.getElementById('auto-launch-toggle'),
  autoLaunchSwitch: document.getElementById('auto-launch-switch'),
  autoLaunchDot: document.getElementById('auto-launch-dot'),
  autoBackupToggle: document.getElementById('auto-backup-toggle'),
  autoBackupSwitch: document.getElementById('auto-backup-switch'),
  autoBackupDot: document.getElementById('auto-backup-dot'),
  autoBackupStatus: document.getElementById('auto-backup-status'),
  autoBackupIntervalValue: document.getElementById('auto-backup-interval-value'),
  autoBackupIntervalUnit: document.getElementById('auto-backup-interval-unit'),
  autoBackupPathText: document.getElementById('auto-backup-path-text'),
  closeActionStatus: document.getElementById('close-action-status'),
  closeActionButtons: [...document.querySelectorAll('[data-close-action]')],
  exportBackupButton: document.getElementById('export-backup-button'),
  importBackupButton: document.getElementById('import-backup-button'),
  backupStatusDot: document.getElementById('backup-status-dot'),
  backupStatusText: document.getElementById('backup-status-text'),
  selectedItemsSummary: document.getElementById('selected-items-summary'),
  itemVisibilityList: document.getElementById('item-visibility-list'),
  selectAllItemsButton: document.getElementById('select-all-items-button'),
  clearAllItemsButton: document.getElementById('clear-all-items-button'),
  itemTemplate: document.getElementById('ranking-item-template'),
  settingItemTemplate: document.getElementById('setting-item-template')
};

function formatDuration(ms, mode = 'long') {
  const totalMinutes = Math.round((ms || 0) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (mode === 'short') {
    if (hours > 0 && minutes > 0) {
      return `${hours}小时${minutes}分钟`;
    }

    if (hours > 0) {
      return `${hours}小时`;
    }

    return `${minutes}分钟`;
  }

  if (hours > 0 && minutes > 0) {
    return `${hours}小时${minutes}分钟`;
  }

  if (hours > 0) {
    return `${hours}小时`;
  }

  return `${minutes}分钟`;
}

function padNumber(value) {
  return String(value).padStart(2, '0');
}

function getLocalDayKey(date = new Date()) {
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`;
}

function formatDayLabel(dayKey) {
  if (!dayKey) {
    return '今天';
  }

  const date = new Date(`${dayKey}T00:00:00`);
  const today = new Date();
  const todayKey = getLocalDayKey(today);
  if (dayKey === todayKey) {
    return `${date.getMonth() + 1}月${date.getDate()}日（今天）`;
  }

  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatWeekRange(dayKeys) {
  if (!dayKeys || !dayKeys.length) {
    return '近 7 天';
  }

  const first = new Date(`${dayKeys[0]}T00:00:00`);
  const last = new Date(`${dayKeys[dayKeys.length - 1]}T00:00:00`);
  return `${first.getMonth() + 1}月${first.getDate()}日 - ${last.getMonth() + 1}月${last.getDate()}日`;
}

function weekdayLabel(dayKey) {
  const value = new Date(`${dayKey}T00:00:00`).getDay();
  return ['日', '一', '二', '三', '四', '五', '六'][value];
}

function formatDateTime(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return `${date.getMonth() + 1}月${date.getDate()}日 ${padNumber(date.getHours())}:${padNumber(date.getMinutes())}`;
}

function getPathLeafName(filePath) {
  const normalized = typeof filePath === 'string' ? filePath.trim() : '';
  if (!normalized) {
    return '';
  }

  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || normalized;
}

function getErrorMessage(error) {
  if (error && typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }

  return '操作失败，请稍后重试。';
}

function setBackupStatus(status) {
  state.backupStatus = {
    ...DEFAULT_BACKUP_STATUS,
    ...(status || {})
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getAutoBackupIntervalParts(intervalMinutes) {
  const numericValue = Math.max(Math.round(Number(intervalMinutes) || 0), 60);
  if (numericValue >= 1440 && numericValue % 1440 === 0) {
    return {
      value: numericValue / 1440,
      unit: 'days'
    };
  }

  return {
    value: Math.max(1, Math.round(numericValue / 60)),
    unit: 'hours'
  };
}

function getAutoBackupIntervalMinutesFromParts(value, unit) {
  const safeUnit = unit === 'days' ? 'days' : 'hours';
  const rawValue = Number.parseInt(String(value), 10);
  const maxValue = safeUnit === 'days' ? 365 : 24 * 365;
  const normalizedValue = clamp(Number.isFinite(rawValue) ? rawValue : 1, 1, maxValue);
  return safeUnit === 'days'
    ? normalizedValue * 24 * 60
    : normalizedValue * 60;
}

function formatAutoBackupInterval(intervalMinutes) {
  const parts = getAutoBackupIntervalParts(intervalMinutes);
  return parts.unit === 'days'
    ? `每 ${parts.value} 天`
    : `每 ${parts.value} 小时`;
}

function getInitials(item) {
  const label = item.label || item.appName || item.host || 'APP';
  const filtered = label.replace(/[^A-Za-z0-9\u4e00-\u9fa5]/g, '').trim();
  if (!filtered) {
    return 'A';
  }

  if (/^[\u4e00-\u9fa5]+$/.test(filtered)) {
    return filtered.slice(0, 2);
  }

  return filtered.slice(0, 2).toUpperCase();
}

function getIconRequestPayload(item) {
  return {
    key: item.key,
    kind: item.kind,
    url: item.url,
    host: item.host,
    executablePath: item.executablePath,
    appName: item.appName,
    browserFamily: item.browserFamily
  };
}

function getHiddenItemKeySet() {
  return new Set(state.settings?.hiddenItemKeys || []);
}

function isItemVisible(itemKey) {
  return !getHiddenItemKeySet().has(itemKey);
}

function mergeHourly(items) {
  const hourly = new Array(24).fill(0);
  items.forEach((item) => {
    (item.hourly || []).forEach((value, index) => {
      hourly[index] += Number(value) || 0;
    });
  });
  return hourly;
}

function getFilteredDay(day) {
  const items = (day?.items || []).filter((item) => isItemVisible(item.key));
  return {
    totalMs: items.reduce((sum, item) => sum + (Number(item.totalMs) || 0), 0),
    items,
    hourly: mergeHourly(items)
  };
}

function getFilteredWeekly(snapshot) {
  const dayKeys = snapshot?.weekly?.dayKeys || [];
  const weeklyMap = new Map();
  let totalMs = 0;

  const dailyTotals = dayKeys.map((dayKey) => {
    const filteredDay = getFilteredDay(snapshot?.daily?.days?.[dayKey]);
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

function getAllKnownItems() {
  const catalog = new Map();

  Object.values(state.snapshot?.daily?.days || {}).forEach((day) => {
    (day.items || []).forEach((item) => {
      const existing = catalog.get(item.key);
      if (!existing) {
        catalog.set(item.key, {
          ...item,
          totalMs: Number(item.totalMs) || 0
        });
        return;
      }

      existing.totalMs += Number(item.totalMs) || 0;
      if ((Number(item.lastSeenAt) || 0) >= (Number(existing.lastSeenAt) || 0)) {
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
        existing.kind = item.kind;
        existing.lastSeenAt = item.lastSeenAt;
      }
    });
  });

  return [...catalog.values()].sort((left, right) => right.totalMs - left.totalMs);
}

function setAvatarContent(element, item, iconDataUrl) {
  if (!element) {
    return;
  }

  element.replaceChildren();
  element.style.background = item.color;
  element.classList.toggle('has-image', Boolean(iconDataUrl));

  if (iconDataUrl) {
    const image = document.createElement('img');
    image.className = 'avatar-image';
    image.src = iconDataUrl;
    image.alt = `${item.label} 图标`;
    element.appendChild(image);
    return;
  }

  element.textContent = getInitials(item);
}

async function requestIcons(items) {
  const pendingItems = items.filter((item) => item?.key && !state.iconCache.has(item.key));
  if (!pendingItems.length) {
    return;
  }

  const iconMap = await window.usageApi.getIcons(pendingItems.map(getIconRequestPayload));
  Object.entries(iconMap || {}).forEach(([key, value]) => {
    state.iconCache.set(key, value || null);
  });
}

function patchRankingIcons(items) {
  items.forEach((item) => {
    const avatar = elements.rankingList.querySelector(`[data-item-key="${CSS.escape(item.key)}"] .app-avatar`);
    if (!avatar) {
      return;
    }

    setAvatarContent(avatar, item, state.iconCache.get(item.key) || null);
  });
}

async function hydrateRankingIcons(items) {
  await requestIcons(items);
  patchRankingIcons(items);
}

async function hydrateDetailIcon(item) {
  await requestIcons([item]);
  if (state.detail && state.detail.key === item.key) {
    setAvatarContent(elements.detailAvatar, item, state.iconCache.get(item.key) || null);
  }
}

function patchSettingsIcons(items) {
  items.forEach((item) => {
    const avatar = elements.itemVisibilityList.querySelector(`[data-item-key="${CSS.escape(item.key)}"] .setting-item-avatar`);
    if (!avatar) {
      return;
    }

    setAvatarContent(avatar, item, state.iconCache.get(item.key) || null);
  });
}

async function hydrateSettingsIcons(items) {
  await requestIcons(items);
  patchSettingsIcons(items);
}

function lookupDay(dayKey) {
  return state.snapshot?.daily?.days?.[dayKey] || {
    totalMs: 0,
    items: [],
    hourly: new Array(24).fill(0)
  };
}

function ensureSelectedDayKey() {
  const availableDays = state.snapshot?.daily?.availableDays || [];
  if (!availableDays.length) {
    state.selectedDayKey = null;
    return;
  }

  if (!state.selectedDayKey || !availableDays.includes(state.selectedDayKey)) {
    state.selectedDayKey = state.snapshot.meta.latestDayKey || availableDays[availableDays.length - 1];
  }
}

function getBrowserExtensionStatus(snapshot = state.snapshot) {
  return snapshot?.meta?.browserExtensionStatus || {
    status: 'missing',
    staleAfterMs: 0,
    activeBrowsers: [],
    seenBrowsers: [],
    latestHeartbeatAt: 0,
    browsers: []
  };
}

function formatBrowserList(browserFamilies) {
  const uniqueBrowsers = [...new Set((browserFamilies || []).filter(Boolean))];
  return uniqueBrowsers.join(' / ');
}

function getBrowserExtensionMessages(status) {
  const activeLabel = formatBrowserList(status.activeBrowsers);
  const seenLabel = formatBrowserList(status.seenBrowsers);

  if (status.status === 'connected' && activeLabel) {
    return {
      summary: `已检测到 ${activeLabel} 插件心跳`,
      detail: '网页访问会按站点归因到具体域名。',
      warning: ''
    };
  }

  if (seenLabel) {
    return {
      summary: `暂未收到 ${seenLabel} 插件心跳`,
      detail: '请检查浏览器扩展是否仍已启用；当前浏览器时长会先记到浏览器应用本身。',
      warning: `最近检测到 ${seenLabel} 插件，但当前没有收到新的心跳。请检查扩展是否仍已启用，否则网页时长不会拆分到具体网站。`
    };
  }

  return {
    summary: '未检测到浏览器插件心跳',
    detail: '若要识别网页站点，请安装并启用浏览器插件；未安装时浏览器时长只会记到浏览器应用。',
    warning: '若要识别网页站点，请安装并启用浏览器插件；否则 Chrome、Edge 等浏览器时长只会记到浏览器应用，不会拆分到具体网站。'
  };
}

function renderBrowserExtensionStatus(snapshot = state.snapshot) {
  const status = getBrowserExtensionStatus(snapshot);
  const messages = getBrowserExtensionMessages(status);
  const isConnected = status.status === 'connected';

  if (elements.browserExtensionWarning) {
    elements.browserExtensionWarning.hidden = isConnected;
  }

  if (elements.browserExtensionWarningText) {
    elements.browserExtensionWarningText.textContent = messages.warning;
  }

  if (elements.browserExtensionStatusDot) {
    elements.browserExtensionStatusDot.classList.toggle('active', isConnected);
    elements.browserExtensionStatusDot.classList.toggle('warning', !isConnected);
  }

  if (elements.browserExtensionStatusText) {
    elements.browserExtensionStatusText.textContent = messages.summary;
  }

  if (elements.browserExtensionStatusDetail) {
    elements.browserExtensionStatusDetail.textContent = messages.detail;
  }
}

function getRankingSubtitle(item) {
  if (item.kind === 'service') {
    return item.subtitle || item.host || item.appName || '';
  }

  if (item.kind === 'site') {
    return item.host || item.subtitle || item.appName || '';
  }

  if (item.kind === 'page') {
    return item.host || item.subtitle || item.url || item.appName || '';
  }

  return item.subtitle || item.windowTitle || item.appName || '';
}

function getDetailSubtitle(detail) {
  if (!detail) {
    return '';
  }

  if (detail.kind === 'service') {
    return detail.host || detail.subtitle || detail.appName || '';
  }

  if (detail.kind === 'site') {
    return detail.host || detail.appName || '';
  }

  if (detail.kind === 'page') {
    return detail.host || detail.url || detail.appName || '';
  }

  return detail.appName || '';
}

function formatTrackingSourceLabel(trackingSource) {
  if (trackingSource === 'hybrid') {
    return 'SMTC + WASAPI';
  }

  if (trackingSource === 'wasapi') {
    return 'WASAPI 音频会话';
  }

  if (trackingSource === 'smtc') {
    return 'SMTC 播放状态';
  }

  return '前台窗口';
}

function getCanvasMetrics(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const fallbackWidth = Number(canvas.getAttribute('width')) || 340;
  const fallbackHeight = Number(canvas.getAttribute('height')) || 240;
  const aspectRatio = fallbackHeight / fallbackWidth;
  const cssWidth = Math.max(Math.round(canvas.getBoundingClientRect().width || canvas.clientWidth || fallbackWidth), 1);
  const cssHeight = Math.max(Math.round(cssWidth * aspectRatio), 1);
  const pixelWidth = Math.max(Math.round(cssWidth * ratio), 1);
  const pixelHeight = Math.max(Math.round(cssHeight * ratio), 1);

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  if (canvas.style.height !== `${cssHeight}px`) {
    canvas.style.height = `${cssHeight}px`;
  }

  return {
    ratio,
    width: cssWidth,
    height: cssHeight
  };
}

function drawBarChart({ canvas, bars, labels, yLabels, color, tooltip, onHover }) {
  const context = canvas.getContext('2d');
  const { ratio, width, height } = getCanvasMetrics(canvas);
  const padding = { top: 14, right: 72, bottom: 30, left: 8 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...bars, 1);
  const step = chartWidth / Math.max(bars.length, 1);
  const barWidth = Math.min(14, step * 0.52);
  const hitAreas = [];

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.font = '12px Segoe UI';
  context.textBaseline = 'middle';

  context.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  context.lineWidth = 1;
  yLabels.forEach((value) => {
    const y = padding.top + chartHeight * (1 - value.ratio);
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right + 4, y);
    context.stroke();
    context.fillStyle = 'rgba(255, 255, 255, 0.45)';
    context.textAlign = 'left';
    context.fillText(value.label, width - padding.right + 12, y);
  });

  bars.forEach((value, index) => {
    const x = padding.left + step * index + (step - barWidth) / 2;
    const barHeight = Math.max(4, (value / maxValue) * chartHeight);
    const y = padding.top + chartHeight - barHeight;
    const label = typeof labels === 'function' ? labels(index) : labels[index];

    context.fillStyle = color;
    context.beginPath();
    context.roundRect(x, y, barWidth, barHeight, 6);
    context.fill();

    if (label) {
      context.fillStyle = 'rgba(255, 255, 255, 0.5)';
      context.textAlign = 'center';
      context.fillText(label, x + barWidth / 2, height - 10);
    }

    hitAreas.push({ x, y, width: barWidth, height: chartHeight, value, label, index });
  });

  canvas.onmousemove = (event) => {
    const rect = canvas.getBoundingClientRect();
    const pointX = event.clientX - rect.left;
    const pointY = event.clientY - rect.top;
    const hit = hitAreas.find((area) => pointX >= area.x && pointX <= area.x + area.width && pointY >= padding.top && pointY <= padding.top + chartHeight);

    if (!hit) {
      tooltip.classList.add('hidden');
      return;
    }

    if (typeof onHover === 'function') {
      onHover(hit, rect);
    }
  };

  canvas.onmouseleave = () => {
    tooltip.classList.add('hidden');
  };
}

function showTooltip({ tooltip, rect, chartPoint, valueText, labelText, rows = [] }) {
  tooltip.replaceChildren();

  const valueNode = document.createElement('span');
  valueNode.className = 'tooltip-value';
  valueNode.textContent = valueText;
  tooltip.appendChild(valueNode);

  if (labelText) {
    const labelNode = document.createElement('span');
    labelNode.className = 'tooltip-label';
    labelNode.textContent = labelText;
    tooltip.appendChild(labelNode);
  }

  if (rows.length) {
    const listNode = document.createElement('div');
    listNode.className = 'tooltip-list';

    rows.forEach((row) => {
      const rowNode = document.createElement('div');
      rowNode.className = 'tooltip-row';

      if (row.chipText) {
        const chipNode = document.createElement('span');
        chipNode.className = 'tooltip-chip';
        chipNode.textContent = row.chipText;
        if (row.chipColor) {
          chipNode.style.background = row.chipColor;
        }
        rowNode.appendChild(chipNode);
      }

      const textNode = document.createElement('span');
      textNode.textContent = row.text;
      rowNode.appendChild(textNode);
      listNode.appendChild(rowNode);
    });

    tooltip.appendChild(listNode);
  }

  tooltip.classList.remove('hidden');
  const relativeX = (chartPoint.x + chartPoint.width / 2) / rect.width;
  const relativeY = chartPoint.y / rect.height;
  tooltip.style.left = `${relativeX * 100}%`;
  tooltip.style.top = `${Math.max(relativeY * 100 - 4, 15)}%`;
}

function updateHeader() {
  const isDetail = state.activeScreen === 'detail';

  elements.topbar.classList.toggle('overview-hidden', !isDetail);
  elements.tabRow.classList.toggle('hidden-nav', isDetail);
  elements.backButton.classList.toggle('inactive', !isDetail);
  elements.screenTitle.textContent = isDetail
    ? (state.detail?.label || '详情')
    : '';
}

function updateTopTabs() {
  const isSettings = state.activeScreen === 'settings';
  elements.rangeTabs.forEach((tab) => {
    if (tab.id === 'settings-button') {
      tab.classList.toggle('active', isSettings);
      return;
    }

    tab.classList.toggle('active', !isSettings && tab.dataset.range === state.selectedRange);
  });
}

function showScreen(screen) {
  state.activeScreen = screen;
  elements.overviewScreen.classList.toggle('active', screen === 'overview');
  elements.detailScreen.classList.toggle('active', screen === 'detail');
  elements.settingsScreen.classList.toggle('active', screen === 'settings');
  updateTopTabs();
  updateHeader();
}

function renderSettingsState() {
  const snapshot = state.snapshot;
  const enabled = Boolean(state.settings?.autoLaunchEnabled);
  const autoBackupEnabled = Boolean(state.settings?.autoBackupEnabled);
  const autoBackupIntervalMinutes = Number(state.settings?.autoBackupIntervalMinutes) || 1440;
  const autoBackupParts = getAutoBackupIntervalParts(autoBackupIntervalMinutes);
  const lastAutoBackupAt = formatDateTime(state.settings?.lastAutoBackupAt);
  const nextAutoBackupAt = formatDateTime(state.settings?.nextAutoBackupAt);
  const autoBackupDirectory = state.settings?.autoBackupDirectory || '';
  const autoBackupError = state.settings?.lastAutoBackupError || '';
  const closeAction = state.settings?.closeWindowAction || 'tray';
  const backupBusyText = state.backupBusy
    ? (state.backupBusyAction === 'import' ? '正在导入并恢复备份...' : '正在导出备份...')
    : state.backupStatus.text;
  const closeActionLabels = {
    exit: '关闭窗口时将直接退出应用',
    tray: '关闭窗口时将最小化到系统托盘',
    ask: '关闭窗口时每次都询问'
  };

  elements.autoLaunchSwitch.classList.toggle('active', enabled);
  elements.autoLaunchDot.classList.toggle('active', enabled);
  elements.autoLaunchStatus.textContent = enabled ? '已开启开机自启动' : '未开启开机自启动';
  elements.autoLaunchToggle.setAttribute('aria-checked', enabled ? 'true' : 'false');

  elements.autoBackupSwitch.classList.toggle('active', autoBackupEnabled);
  elements.autoBackupDot.classList.toggle('active', autoBackupEnabled && !autoBackupError);
  elements.autoBackupDot.classList.toggle('warning', Boolean(autoBackupError));
  elements.autoBackupToggle.setAttribute('aria-checked', autoBackupEnabled ? 'true' : 'false');
  elements.autoBackupToggle.disabled = state.updatingAutoBackup;
  elements.autoBackupIntervalValue.value = String(autoBackupParts.value);
  elements.autoBackupIntervalValue.disabled = state.updatingAutoBackup;
  elements.autoBackupIntervalUnit.value = autoBackupParts.unit;
  elements.autoBackupIntervalUnit.disabled = state.updatingAutoBackup;

  if (autoBackupError) {
    elements.autoBackupStatus.textContent = `上次自动备份失败：${autoBackupError}`;
  } else if (autoBackupEnabled && lastAutoBackupAt && nextAutoBackupAt) {
    elements.autoBackupStatus.textContent = `${formatAutoBackupInterval(autoBackupIntervalMinutes)}自动备份，上次成功于 ${lastAutoBackupAt}，下次计划 ${nextAutoBackupAt}`;
  } else if (autoBackupEnabled && nextAutoBackupAt) {
    elements.autoBackupStatus.textContent = `${formatAutoBackupInterval(autoBackupIntervalMinutes)}自动备份，首次计划 ${nextAutoBackupAt}`;
  } else {
    elements.autoBackupStatus.textContent = '自动备份已关闭';
  }

  elements.autoBackupPathText.textContent = autoBackupDirectory
    ? `自动备份目录：${autoBackupDirectory}`
    : '自动备份目录读取中';

  elements.closeActionStatus.textContent = closeActionLabels[closeAction] || closeActionLabels.tray;
  elements.closeActionButtons.forEach((button) => {
    const isActive = button.dataset.closeAction === closeAction;
    button.classList.toggle('active', isActive);
    button.disabled = state.updatingCloseAction;
    button.setAttribute('aria-checked', isActive ? 'true' : 'false');
  });

  elements.exportBackupButton.disabled = state.backupBusy;
  elements.importBackupButton.disabled = state.backupBusy;
  elements.backupStatusDot.classList.toggle('active', state.backupBusy || state.backupStatus.tone === 'success');
  elements.backupStatusDot.classList.toggle('warning', state.backupStatus.tone === 'error');
  elements.backupStatusText.textContent = backupBusyText;

  elements.settingsBridgeUrlText.textContent = snapshot?.meta?.bridgeUrl
    ? `本地 bridge 地址：${snapshot.meta.bridgeUrl}`
    : '本地 bridge 地址读取中';
  renderBrowserExtensionStatus(snapshot);
}

function renderItemVisibilitySettings() {
  const items = getAllKnownItems();
  const hiddenKeys = getHiddenItemKeySet();
  const selectedCount = items.filter((item) => !hiddenKeys.has(item.key)).length;

  elements.selectedItemsSummary.textContent = items.length
    ? `已选择 ${selectedCount} / ${items.length} 项`
    : '暂无可配置的统计项';
  elements.selectAllItemsButton.disabled = !items.length || selectedCount === items.length || state.updatingHiddenItems;
  elements.clearAllItemsButton.disabled = !items.length || selectedCount === 0 || state.updatingHiddenItems;
  elements.itemVisibilityList.replaceChildren();

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'ranking-subtitle';
    empty.textContent = '采集到统计数据后，这里会显示可选项目。';
    elements.itemVisibilityList.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const fragment = elements.settingItemTemplate.content.cloneNode(true);
    const row = fragment.querySelector('.setting-check-item');
    const input = fragment.querySelector('.setting-checkbox-input');
    const avatar = fragment.querySelector('.setting-item-avatar');
    const name = fragment.querySelector('.setting-item-name');
    const checked = !hiddenKeys.has(item.key);

    row.dataset.itemKey = item.key;
    input.checked = checked;
    input.disabled = state.updatingHiddenItems;
    input.dataset.itemKey = item.key;
    input.setAttribute('aria-label', `切换 ${item.label} 的显示状态`);
    name.textContent = item.label;
    setAvatarContent(avatar, item, state.iconCache.get(item.key) || null);

    input.addEventListener('change', () => {
      updateItemVisibility(item.key, input.checked).catch(() => {
        input.checked = !input.checked;
      });
    });

    elements.itemVisibilityList.appendChild(fragment);
  });

  hydrateSettingsIcons(items).catch(() => {});
}

function renderRanking(items, totalMs) {
  elements.rankingList.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'ranking-subtitle';
    empty.textContent = '当前还没有采集到使用数据。';
    elements.rankingList.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const fragment = elements.itemTemplate.content.cloneNode(true);
    const button = fragment.querySelector('.ranking-item');
    const avatar = fragment.querySelector('.app-avatar');
    const name = fragment.querySelector('.ranking-name');
    const duration = fragment.querySelector('.ranking-duration');
    const subtitle = fragment.querySelector('.ranking-subtitle');
    const progress = fragment.querySelector('.progress-bar');
    const ratio = totalMs ? Math.max(item.totalMs / totalMs, 0.04) : 0;

    button.dataset.itemKey = item.key;
    setAvatarContent(avatar, item, state.iconCache.get(item.key) || null);
    name.textContent = item.label;
    duration.textContent = formatDuration(item.totalMs, 'short');
    subtitle.textContent = getRankingSubtitle(item);
    progress.style.width = `${Math.round(ratio * 100)}%`;
    progress.style.background = `linear-gradient(90deg, ${item.color}, #2ca9ff)`;
    button.addEventListener('click', () => openDetail(item.key));
    elements.rankingList.appendChild(fragment);
  });

  hydrateRankingIcons(items).catch(() => {});
}

function renderOverview() {
  const snapshot = state.snapshot;
  if (!snapshot) {
    return;
  }

  ensureSelectedDayKey();
  const activeDay = getFilteredDay(lookupDay(state.selectedDayKey));
  const weekly = getFilteredWeekly(snapshot);
  const isDaily = state.selectedRange === 'daily';
  const rankingItems = isDaily ? activeDay.items : weekly.items;
  const totalMs = isDaily ? activeDay.totalMs : weekly.totalMs;

  elements.previousDay.style.visibility = isDaily ? 'visible' : 'hidden';
  elements.nextDay.style.visibility = isDaily ? 'visible' : 'hidden';
  elements.dateLabel.textContent = isDaily ? formatDayLabel(state.selectedDayKey) : formatWeekRange(weekly.dayKeys);
  elements.chartSectionTitle.textContent = isDaily ? '使用时长（截至今天）' : '使用时长（近 7 天）';
  elements.summaryDuration.textContent = isDaily ? formatDuration(activeDay.totalMs) : formatDuration(weekly.averageMs, 'short');
  elements.summarySubtitle.textContent = isDaily ? '' : `总时长：${formatDuration(weekly.totalMs)}`;

  renderRanking(rankingItems, totalMs);
  renderSettingsState();

  if (isDaily) {
    const hourly = activeDay.hourly;
    drawBarChart({
      canvas: elements.chartCanvas,
      bars: hourly.map((value) => Math.round(value / 60000)),
      labels: (index) => ({ 0: '0 时', 6: '6 时', 12: '12 时', 18: '18 时' }[index] || ''),
      yLabels: [
        { ratio: 0, label: '0' },
        { ratio: 0.5, label: '30 分钟' },
        { ratio: 1, label: '60 分钟' }
      ],
      color: '#1a8dff',
      tooltip: elements.chartTooltip,
      onHover: (hit, rect) => {
        const topItems = activeDay.items
          .map((item) => ({
            label: item.label,
            initials: getInitials(item),
            color: item.color,
            minutes: Math.round(((item.hourly && item.hourly[hit.index]) || 0) / 60000)
          }))
          .filter((item) => item.minutes > 0)
          .sort((left, right) => right.minutes - left.minutes)
          .slice(0, 3);

        showTooltip(
          {
            tooltip: elements.chartTooltip,
            rect,
            chartPoint: hit,
            valueText: formatDuration(hit.value * 60000),
            labelText: `${hit.index} 时 - ${hit.index + 1} 时`,
            rows: topItems.map((item) => ({
              chipColor: item.color,
              chipText: item.initials,
              text: `${item.label} ${item.minutes}分钟`
            }))
          }
        );
      }
    });
  } else {
    drawBarChart({
      canvas: elements.chartCanvas,
      bars: weekly.dailyTotals.map((item) => Math.round((item.totalMs / 3600000) * 10) / 10),
      labels: weekly.dayKeys.map((dayKey) => weekdayLabel(dayKey)),
      yLabels: [
        { ratio: 0, label: '0' },
        { ratio: 0.66, label: '平均' },
        { ratio: 1, label: '12 小时' }
      ],
      color: '#1a8dff',
      tooltip: elements.chartTooltip,
      onHover: (hit, rect) => {
        const dayKey = weekly.dayKeys[hit.index];
        const topItems = weekly.items
          .map((item) => ({
            label: item.label,
            initials: getInitials(item),
            color: item.color,
            duration: item.byDay?.[dayKey] || 0
          }))
          .filter((item) => item.duration > 0)
          .sort((left, right) => right.duration - left.duration)
          .slice(0, 3);

        showTooltip(
          {
            tooltip: elements.chartTooltip,
            rect,
            chartPoint: hit,
            valueText: formatDuration(weekly.dailyTotals[hit.index].totalMs),
            labelText: formatDayLabel(dayKey),
            rows: topItems.map((item) => ({
              chipColor: item.color,
              chipText: item.initials,
              text: `${item.label} ${formatDuration(item.duration, 'short')}`
            }))
          }
        );
      }
    });
  }

  showScreen('overview');
}

function renderDetail() {
  const detail = state.detail;
  if (!detail) {
    renderOverview();
    return;
  }

  setAvatarContent(elements.detailAvatar, detail, state.iconCache.get(detail.key) || null);
  elements.detailTitle.textContent = detail.label;
  elements.detailSubtitle.textContent = getDetailSubtitle(detail);
  elements.detailTodayDuration.textContent = formatDuration(detail.todayHourly.reduce((sum, item) => sum + item, 0));
  elements.detailWeekAverage.textContent = `日均 ${formatDuration(detail.averageMs, 'short')}`;
  elements.detailWeekTotal.textContent = `总时长：${formatDuration(detail.totalMs)}`;

  elements.detailMeta.replaceChildren();
  const metaRows = detail.kind === 'service'
    ? [
        ['服务', detail.label],
        ['站点域名', detail.host],
        ['最近内容标题', detail.pageTitle || detail.windowTitle],
        ['最近网页地址', detail.url],
        ['本地应用可执行文件', detail.executablePath]
      ]
    : detail.kind === 'site'
    ? [
        ['应用', detail.appName],
        ['站点域名', detail.host],
        ['最近网页标题', detail.pageTitle || detail.windowTitle],
        ['最近网页地址', detail.url],
        ['可执行文件', detail.executablePath]
      ]
    : [
        ['应用', detail.appName],
        ['计时方式', detail.trackingMode === 'playback' ? formatTrackingSourceLabel(detail.trackingSource) : '前台窗口'],
        ['最近播放内容', detail.mediaTitle],
        ['最近播放艺人', detail.mediaArtist],
        ['音频会话进程', detail.processName],
        ['音频会话状态', detail.audioSessionState],
        ['音频峰值', detail.audioPeakValue ? detail.audioPeakValue.toFixed(3) : '0.000'],
        ['来源标识', detail.sourceAppUserModelId],
        ['页面标题', detail.pageTitle || detail.windowTitle],
        ['网页地址', detail.url],
        ['域名', detail.host],
        ['可执行文件', detail.executablePath]
      ];

  metaRows
    .filter(([, value]) => value)
    .forEach(([label, value]) => {
      const row = document.createElement('div');
      row.className = 'metadata-row';
      const labelNode = document.createElement('div');
      labelNode.className = 'metadata-label';
      labelNode.textContent = label;

      const valueNode = document.createElement('div');
      valueNode.className = 'metadata-value';
      valueNode.textContent = value;

      row.appendChild(labelNode);
      row.appendChild(valueNode);
      elements.detailMeta.appendChild(row);
    });

  drawBarChart({
    canvas: elements.detailDayChart,
    bars: detail.todayHourly.map((value) => Math.round(value / 60000)),
    labels: (index) => ({ 0: '0', 6: '6', 12: '12', 18: '18' }[index] || ''),
    yLabels: [
      { ratio: 0, label: '0' },
      { ratio: 0.5, label: '30 分钟' },
      { ratio: 1, label: '60 分钟' }
    ],
    color: detail.color,
    tooltip: elements.detailDayTooltip,
    onHover: (hit, rect) => {
      showTooltip(
        {
          tooltip: elements.detailDayTooltip,
          rect,
          chartPoint: hit,
          valueText: formatDuration(hit.value * 60000),
          labelText: `${hit.index} 时 - ${hit.index + 1} 时`
        }
      );
    }
  });

  drawBarChart({
    canvas: elements.detailWeekChart,
    bars: detail.lastSevenDays.map((item) => Math.round(item.totalMs / 60000)),
    labels: detail.lastSevenDays.map((item) => weekdayLabel(item.dayKey)),
    yLabels: [
      { ratio: 0, label: '0' },
      { ratio: 0.5, label: '平均' },
      { ratio: 1, label: '120 分钟' }
    ],
    color: detail.color,
    tooltip: elements.detailWeekTooltip,
    onHover: (hit, rect) => {
      const day = detail.lastSevenDays[hit.index];
      showTooltip(
        {
          tooltip: elements.detailWeekTooltip,
          rect,
          chartPoint: hit,
          valueText: formatDuration(day.totalMs),
          labelText: formatDayLabel(day.dayKey)
        }
      );
    }
  });

  hydrateDetailIcon(detail).catch(() => {});
  showScreen('detail');
}

function renderSettingsScreen() {
  renderSettingsState();
  renderItemVisibilitySettings();
  showScreen('settings');
}

async function handleBackupExport() {
  if (state.backupBusy) {
    return;
  }

  state.backupBusy = true;
  state.backupBusyAction = 'export';
  renderSettingsScreen();

  try {
    const result = await window.usageApi.exportBackup();
    if (result?.canceled) {
      setBackupStatus({
        tone: 'neutral',
        text: '已取消导出备份。'
      });
      return;
    }

    const fileName = getPathLeafName(result?.filePath);
    const exportedAt = formatDateTime(result?.exportedAt);
    setBackupStatus({
      tone: 'success',
      text: exportedAt
        ? `备份已导出到 ${fileName || '所选文件'}，导出时间 ${exportedAt}。`
        : `备份已导出到 ${fileName || '所选文件'}。`
    });
  } catch (error) {
    setBackupStatus({
      tone: 'error',
      text: `导出失败：${getErrorMessage(error)}`
    });
  } finally {
    state.backupBusy = false;
    state.backupBusyAction = '';
  }

  renderSettingsScreen();
}

async function handleBackupImport() {
  if (state.backupBusy) {
    return;
  }

  state.backupBusy = true;
  state.backupBusyAction = 'import';
  renderSettingsScreen();

  try {
    const result = await window.usageApi.importBackup();
    if (result?.canceled) {
      setBackupStatus({
        tone: 'neutral',
        text: '已取消恢复备份。'
      });
      return;
    }

    [state.snapshot, state.settings] = await Promise.all([
      window.usageApi.getSnapshot(),
      window.usageApi.getSettings()
    ]);
    ensureSelectedDayKey();
    state.detailItemKey = null;
    state.detail = null;

    const fileName = getPathLeafName(result?.filePath);
    const restoredAt = formatDateTime(result?.restoredAt);
    const exportedAt = formatDateTime(result?.exportedAt);
    const summaryParts = [
      `已从 ${fileName || '所选文件'} 恢复备份`
    ];

    if (exportedAt) {
      summaryParts.push(`原备份时间 ${exportedAt}`);
    }

    if (restoredAt) {
      summaryParts.push(`恢复完成时间 ${restoredAt}`);
    }

    if (result?.settingsRestored) {
      summaryParts.push('并已同步恢复应用设置');
    }

    setBackupStatus({
      tone: 'success',
      text: `${summaryParts.join('，')}。`
    });
  } catch (error) {
    setBackupStatus({
      tone: 'error',
      text: `恢复失败：${getErrorMessage(error)}`
    });
  } finally {
    state.backupBusy = false;
    state.backupBusyAction = '';
  }

  renderSettingsScreen();
}

async function updateAutoBackupSettings(partialSettings = {}) {
  if (state.updatingAutoBackup) {
    return;
  }

  const previousSettings = state.settings || {
    autoLaunchEnabled: false,
    hiddenItemKeys: [],
    closeWindowAction: 'tray',
    autoBackupEnabled: false,
    autoBackupIntervalMinutes: 1440
  };
  const nextSettings = {
    autoBackupEnabled: Object.prototype.hasOwnProperty.call(partialSettings, 'autoBackupEnabled')
      ? Boolean(partialSettings.autoBackupEnabled)
      : Boolean(previousSettings.autoBackupEnabled),
    autoBackupIntervalMinutes: Object.prototype.hasOwnProperty.call(partialSettings, 'autoBackupIntervalMinutes')
      ? clamp(Math.round(Number(partialSettings.autoBackupIntervalMinutes) || 1440), 60, 365 * 24 * 60)
      : Number(previousSettings.autoBackupIntervalMinutes) || 1440
  };

  state.updatingAutoBackup = true;
  state.settings = {
    ...previousSettings,
    ...nextSettings,
    lastAutoBackupError: ''
  };
  renderSettingsScreen();

  try {
    state.settings = await window.usageApi.setAutoBackupSettings(nextSettings);
  } catch (error) {
    state.settings = previousSettings;
    renderSettingsScreen();
    throw error;
  } finally {
    state.updatingAutoBackup = false;
  }

  renderSettingsScreen();
}

async function updateCloseWindowAction(closeWindowAction) {
  if (state.updatingCloseAction) {
    return;
  }

  const previousSettings = state.settings || { autoLaunchEnabled: false, hiddenItemKeys: [], closeWindowAction: 'tray' };
  state.updatingCloseAction = true;
  state.settings = {
    ...previousSettings,
    closeWindowAction
  };
  renderSettingsScreen();

  try {
    state.settings = await window.usageApi.setCloseWindowAction(closeWindowAction);
  } catch (error) {
    state.settings = previousSettings;
    renderSettingsScreen();
    throw error;
  } finally {
    state.updatingCloseAction = false;
  }

  renderSettingsScreen();
}

async function openDetail(itemKey) {
  if (!isItemVisible(itemKey)) {
    returnToOverview();
    return;
  }

  state.detailItemKey = itemKey;
  const requestedItemKey = itemKey;
  const detail = await window.usageApi.getDetail(itemKey);
  if (state.detailItemKey !== requestedItemKey) {
    return;
  }

  if (!detail) {
    state.detailItemKey = null;
    state.detail = null;
    renderOverview();
    return;
  }

  state.detail = detail;
  renderDetail();
}

function returnToOverview() {
  state.detailItemKey = null;
  state.detail = null;
  renderOverview();
}

function renderCurrentScreen() {
  if (state.activeScreen === 'settings') {
    renderSettingsScreen();
    return;
  }

  if (state.activeScreen === 'detail' && state.detail) {
    renderDetail();
    return;
  }

  renderOverview();
}

function restoreSettingsViewport(pageScrollTop, listScrollTop, activeItemKey) {
  requestAnimationFrame(() => {
    if (state.activeScreen !== 'settings') {
      return;
    }

    window.scrollTo({ top: pageScrollTop, behavior: 'instant' });

    if (elements.itemVisibilityList) {
      elements.itemVisibilityList.scrollTop = listScrollTop;
    }

    if (activeItemKey) {
      const input = elements.itemVisibilityList.querySelector(`.setting-checkbox-input[data-item-key="${CSS.escape(activeItemKey)}"]`);
      if (input && typeof input.focus === 'function') {
        input.focus({ preventScroll: true });
      }
    }
  });
}

async function updateHiddenItemKeys(hiddenItemKeys) {
  const nextHiddenItemKeys = [...new Set(hiddenItemKeys)];
  const previousSettings = state.settings || { autoLaunchEnabled: false, hiddenItemKeys: [] };
  const previousPageScrollTop = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
  const previousListScrollTop = state.activeScreen === 'settings' && elements.itemVisibilityList
    ? elements.itemVisibilityList.scrollTop
    : 0;
  const activeItemKey = document.activeElement?.dataset?.itemKey || null;

  state.updatingHiddenItems = true;
  state.settings = {
    ...previousSettings,
    hiddenItemKeys: nextHiddenItemKeys
  };
  renderCurrentScreen();

  try {
    state.settings = await window.usageApi.setHiddenItemKeys(nextHiddenItemKeys);
  } catch (error) {
    state.settings = previousSettings;
    renderCurrentScreen();
    restoreSettingsViewport(previousPageScrollTop, previousListScrollTop, activeItemKey);
    throw error;
  } finally {
    state.updatingHiddenItems = false;
  }

  if (state.detailItemKey && !isItemVisible(state.detailItemKey)) {
    returnToOverview();
    return;
  }

  renderCurrentScreen();
  restoreSettingsViewport(previousPageScrollTop, previousListScrollTop, activeItemKey);
}

async function updateItemVisibility(itemKey, isVisible) {
  const hiddenKeys = getHiddenItemKeySet();
  if (isVisible) {
    hiddenKeys.delete(itemKey);
  } else {
    hiddenKeys.add(itemKey);
  }

  await updateHiddenItemKeys([...hiddenKeys]);
}

function bindEvents() {
  const commitAutoBackupInterval = () => {
    const intervalMinutes = getAutoBackupIntervalMinutesFromParts(
      elements.autoBackupIntervalValue.value,
      elements.autoBackupIntervalUnit.value
    );
    updateAutoBackupSettings({ autoBackupIntervalMinutes: intervalMinutes }).catch(() => {});
  };

  elements.rangeTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      if (tab.id === 'settings-button') {
        renderSettingsScreen();
        return;
      }

      state.selectedRange = tab.dataset.range;
      renderOverview();
    });
  });

  elements.previousDay.addEventListener('click', () => {
    if (!state.snapshot || state.selectedRange !== 'daily') {
      return;
    }

    const days = state.snapshot.daily.availableDays;
    const currentIndex = days.indexOf(state.selectedDayKey);
    if (currentIndex > 0) {
      state.selectedDayKey = days[currentIndex - 1];
      renderOverview();
    }
  });

  elements.nextDay.addEventListener('click', () => {
    if (!state.snapshot || state.selectedRange !== 'daily') {
      return;
    }

    const days = state.snapshot.daily.availableDays;
    const currentIndex = days.indexOf(state.selectedDayKey);
    if (currentIndex >= 0 && currentIndex < days.length - 1) {
      state.selectedDayKey = days[currentIndex + 1];
      renderOverview();
    }
  });

  elements.refreshButton.addEventListener('click', async () => {
    state.snapshot = await window.usageApi.forcePoll();
    renderOverview();
  });
  elements.autoLaunchToggle.addEventListener('click', async () => {
    const nextValue = !Boolean(state.settings?.autoLaunchEnabled);
    elements.autoLaunchToggle.disabled = true;
    try {
      state.settings = await window.usageApi.setAutoLaunch(nextValue);
      renderSettingsScreen();
    } finally {
      elements.autoLaunchToggle.disabled = false;
    }
  });

  elements.autoBackupToggle.addEventListener('click', () => {
    updateAutoBackupSettings({
      autoBackupEnabled: !Boolean(state.settings?.autoBackupEnabled)
    }).catch(() => {});
  });

  elements.autoBackupIntervalValue.addEventListener('change', commitAutoBackupInterval);
  elements.autoBackupIntervalValue.addEventListener('blur', commitAutoBackupInterval);
  elements.autoBackupIntervalUnit.addEventListener('change', commitAutoBackupInterval);

  elements.closeActionButtons.forEach((button) => {
    button.addEventListener('click', () => {
      updateCloseWindowAction(button.dataset.closeAction).catch(() => {});
    });
  });

  elements.exportBackupButton.addEventListener('click', () => {
    handleBackupExport().catch(() => {});
  });

  elements.importBackupButton.addEventListener('click', () => {
    handleBackupImport().catch(() => {});
  });

  elements.selectAllItemsButton.addEventListener('click', () => {
    updateHiddenItemKeys([]).catch(() => {});
  });

  elements.clearAllItemsButton.addEventListener('click', () => {
    const itemKeys = getAllKnownItems().map((item) => item.key);
    updateHiddenItemKeys(itemKeys).catch(() => {});
  });

  elements.backButton.addEventListener('click', () => {
    if (state.activeScreen === 'overview') {
      return;
    }

    returnToOverview();
  });
}

async function bootstrap() {
  bindEvents();
  [state.snapshot, state.settings] = await Promise.all([
    window.usageApi.getSnapshot(),
    window.usageApi.getSettings()
  ]);

  ensureSelectedDayKey();
  renderOverview();

  state.unsubscribe = window.usageApi.onDataChanged((snapshot) => {
    state.snapshot = snapshot;
    ensureSelectedDayKey();

    if (state.detailItemKey) {
      openDetail(state.detailItemKey);
      return;
    }

    if (state.activeScreen === 'settings') {
      renderSettingsScreen();
      return;
    }

    renderOverview();
  });

  window.usageApi.onSettingsChanged((settings) => {
    state.settings = settings;
    if (state.detailItemKey && !isItemVisible(state.detailItemKey)) {
      returnToOverview();
      return;
    }

    renderCurrentScreen();
  });
}

bootstrap();
