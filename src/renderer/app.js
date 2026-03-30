const DEFAULT_BACKUP_STATUS = Object.freeze({
  tone: 'neutral',
  text: '可将当前统计数据与设置导出为 JSON 备份文件，也支持导入旧的 usage-data.json。'
});
const THEME_PREFERENCE_LIGHT = 'light';
const THEME_PREFERENCE_DARK = 'dark';
const THEME_PREFERENCE_SYSTEM = 'system';
const TIMELINE_HOUR_WIDTH = 180;
const TIMELINE_LANE_HEIGHT = 82;
const TIMELINE_CARD_HEIGHT = 66;
const TIMELINE_MIN_SESSION_WIDTH = 14;
const TIMELINE_COMPACT_SESSION_WIDTH = 88;
const TIMELINE_CONDENSED_SESSION_WIDTH = 168;
const DEFAULT_CATEGORY_OPTIONS = Object.freeze([
  { id: 'work', label: '工作' },
  { id: 'entertainment', label: '娱乐' },
  { id: 'study', label: '学习' },
  { id: 'communication', label: '沟通' }
]);
const SETTINGS_SECTION_IDS = Object.freeze([
  'general',
  'tracking',
  'rules',
  'backup',
  'display'
]);
const overviewDesktopMediaQuery = typeof window.matchMedia === 'function'
  ? window.matchMedia('(min-width: 900px)')
  : null;
const systemThemeMediaQuery = typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null;

const state = {
  snapshot: null,
  settings: null,
  timeline: null,
  timelineLoading: false,
  timelineRequestId: 0,
  timelineRequestedDayKey: null,
  selectedRange: 'daily',
  selectedDayKey: null,
  detailItemKey: null,
  detailReturnScreen: 'overview',
  detail: null,
  activeScreen: 'overview',
  selectedSettingsSection: SETTINGS_SECTION_IDS[0],
  iconCache: new Map(),
  unsubscribe: null,
  updatingHiddenItems: false,
  updatingCloseAction: false,
  updatingThemePreference: false,
  updatingTrackingProtection: false,
  updatingManualPause: false,
  updatingAutoBackup: false,
  updatingServiceRules: false,
  updatingCategoryRules: false,
  backupBusy: false,
  backupBusyAction: '',
  backupStatus: { ...DEFAULT_BACKUP_STATUS },
  serviceRuleDrafts: [],
  categoryRuleDrafts: []
};

const elements = {
  topbar: document.querySelector('.topbar'),
  tabRow: document.getElementById('range-tabs'),
  screenTitle: document.getElementById('screen-title'),
  overviewScreen: document.getElementById('overview-screen'),
  overviewChartCard: document.querySelector('.chart-section .chart-card'),
  overviewRankingCard: document.querySelector('.ranking-section .list-card'),
  timelineScreen: document.getElementById('timeline-screen'),
  detailScreen: document.getElementById('detail-screen'),
  settingsScreen: document.getElementById('settings-screen'),
  settingsSubnav: document.getElementById('settings-subnav'),
  timelineButton: document.getElementById('timeline-button'),
  settingsButton: document.getElementById('settings-button'),
  rangeTabs: [...document.querySelectorAll('.range-tab')],
  settingsSectionTabs: [...document.querySelectorAll('[data-settings-section]')],
  settingsSectionPanels: [...document.querySelectorAll('[data-settings-section-panel]')],
  previousDay: document.getElementById('previous-day'),
  nextDay: document.getElementById('next-day'),
  dateLabel: document.getElementById('date-label'),
  timelinePreviousDay: document.getElementById('timeline-previous-day'),
  timelineNextDay: document.getElementById('timeline-next-day'),
  timelineDateLabel: document.getElementById('timeline-date-label'),
  trackingPauseWarning: document.getElementById('tracking-pause-warning'),
  trackingPauseWarningTitle: document.getElementById('tracking-pause-warning-title'),
  trackingPauseWarningText: document.getElementById('tracking-pause-warning-text'),
  overviewBridgeDot: document.getElementById('overview-bridge-dot'),
  overviewBridgeStatus: document.getElementById('overview-bridge-status'),
  overviewBridgeCaption: document.getElementById('overview-bridge-caption'),
  chartSectionTitle: document.getElementById('chart-section-title'),
  summaryDuration: document.getElementById('summary-duration'),
  summarySubtitle: document.getElementById('summary-subtitle'),
  chartCanvas: document.getElementById('usage-chart'),
  chartTooltip: document.getElementById('chart-tooltip'),
  rankingList: document.getElementById('ranking-list'),
  rankingSummary: document.getElementById('ranking-summary'),
  timelineDaySummary: document.getElementById('timeline-day-summary'),
  timelineLiveDot: document.getElementById('timeline-live-dot'),
  timelineLiveStatus: document.getElementById('timeline-live-status'),
  timelineBoard: document.getElementById('timeline-board'),
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
  detailPagesSection: document.getElementById('detail-pages-section'),
  detailPagesSummary: document.getElementById('detail-pages-summary'),
  detailPagesList: document.getElementById('detail-pages-list'),
  autoLaunchStatus: document.getElementById('auto-launch-status'),
  autoLaunchToggle: document.getElementById('auto-launch-toggle'),
  autoLaunchSwitch: document.getElementById('auto-launch-switch'),
  autoLaunchDot: document.getElementById('auto-launch-dot'),
  manualPauseStatus: document.getElementById('manual-pause-status'),
  manualPauseToggle: document.getElementById('manual-pause-toggle'),
  manualPauseSwitch: document.getElementById('manual-pause-switch'),
  manualPauseDot: document.getElementById('manual-pause-dot'),
  idleDetectionToggle: document.getElementById('idle-detection-toggle'),
  idleDetectionSwitch: document.getElementById('idle-detection-switch'),
  idleDetectionDot: document.getElementById('idle-detection-dot'),
  idleDetectionStatus: document.getElementById('idle-detection-status'),
  idleThresholdValue: document.getElementById('idle-threshold-value'),
  lockScreenPauseStatus: document.getElementById('lock-screen-pause-status'),
  lockScreenPauseToggle: document.getElementById('lock-screen-pause-toggle'),
  lockScreenPauseSwitch: document.getElementById('lock-screen-pause-switch'),
  lockScreenPauseDot: document.getElementById('lock-screen-pause-dot'),
  autoBackupToggle: document.getElementById('auto-backup-toggle'),
  autoBackupSwitch: document.getElementById('auto-backup-switch'),
  autoBackupDot: document.getElementById('auto-backup-dot'),
  autoBackupStatus: document.getElementById('auto-backup-status'),
  autoBackupIntervalValue: document.getElementById('auto-backup-interval-value'),
  autoBackupIntervalUnit: document.getElementById('auto-backup-interval-unit'),
  autoBackupPathText: document.getElementById('auto-backup-path-text'),
  closeActionStatus: document.getElementById('close-action-status'),
  closeActionButtons: [...document.querySelectorAll('[data-close-action]')],
  themeStatusDot: document.getElementById('theme-status-dot'),
  themeStatusText: document.getElementById('theme-status-text'),
  themePreferenceButtons: [...document.querySelectorAll('[data-theme-preference]')],
  exportBackupButton: document.getElementById('export-backup-button'),
  importBackupButton: document.getElementById('import-backup-button'),
  backupStatusDot: document.getElementById('backup-status-dot'),
  backupStatusText: document.getElementById('backup-status-text'),
  addServiceRuleButton: document.getElementById('add-service-rule-button'),
  saveServiceRulesButton: document.getElementById('save-service-rules-button'),
  serviceRulesSummary: document.getElementById('service-rules-summary'),
  serviceRuleList: document.getElementById('service-rule-list'),
  addCategoryRuleButton: document.getElementById('add-category-rule-button'),
  saveCategoryRulesButton: document.getElementById('save-category-rules-button'),
  categoryRulesSummary: document.getElementById('category-rules-summary'),
  categoryRuleList: document.getElementById('category-rule-list'),
  selectedItemsSummary: document.getElementById('selected-items-summary'),
  itemVisibilityList: document.getElementById('item-visibility-list'),
  selectAllItemsButton: document.getElementById('select-all-items-button'),
  clearAllItemsButton: document.getElementById('clear-all-items-button'),
  itemTemplate: document.getElementById('ranking-item-template'),
  settingItemTemplate: document.getElementById('setting-item-template')
};

let overviewLayoutSyncFrame = 0;

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

function normalizeSettingsSection(section) {
  return SETTINGS_SECTION_IDS.includes(section) ? section : SETTINGS_SECTION_IDS[0];
}

function clearOverviewRankingCardHeight() {
  if (!elements.overviewRankingCard) {
    return;
  }

  elements.overviewRankingCard.style.removeProperty('height');
}

function syncOverviewRankingCardHeight() {
  overviewLayoutSyncFrame = 0;

  const chartCard = elements.overviewChartCard;
  const rankingCard = elements.overviewRankingCard;
  const isDesktop = overviewDesktopMediaQuery ? overviewDesktopMediaQuery.matches : window.innerWidth >= 900;

  if (!chartCard || !rankingCard || state.activeScreen !== 'overview' || !isDesktop) {
    clearOverviewRankingCardHeight();
    return;
  }

  const chartCardHeight = Math.round(chartCard.getBoundingClientRect().height);
  if (!chartCardHeight) {
    clearOverviewRankingCardHeight();
    return;
  }

  rankingCard.style.height = `${chartCardHeight}px`;
}

function queueOverviewRankingCardHeightSync() {
  if (overviewLayoutSyncFrame) {
    window.cancelAnimationFrame(overviewLayoutSyncFrame);
  }

  overviewLayoutSyncFrame = window.requestAnimationFrame(syncOverviewRankingCardHeight);
}

function padNumber(value) {
  return String(value).padStart(2, '0');
}

function colorToRgbTriplet(color) {
  const value = String(color || '').trim();
  const hexMatch = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1].length === 3
      ? hexMatch[1].split('').map((segment) => segment + segment).join('')
      : hexMatch[1];
    const red = parseInt(hex.slice(0, 2), 16);
    const green = parseInt(hex.slice(2, 4), 16);
    const blue = parseInt(hex.slice(4, 6), 16);
    return `${red}, ${green}, ${blue}`;
  }

  const rgbMatch = value.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbMatch) {
    const channels = rgbMatch[1]
      .split(',')
      .slice(0, 3)
      .map((segment) => Math.max(0, Math.min(255, Math.round(Number.parseFloat(segment) || 0))));
    if (channels.length === 3) {
      return channels.join(', ');
    }
  }

  return '';
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

function normalizeThemePreference(value) {
  if (value === THEME_PREFERENCE_LIGHT || value === THEME_PREFERENCE_DARK || value === THEME_PREFERENCE_SYSTEM) {
    return value;
  }

  return THEME_PREFERENCE_SYSTEM;
}

function getResolvedTheme(preference = state.settings?.themePreference) {
  const normalizedPreference = normalizeThemePreference(preference);
  if (normalizedPreference === THEME_PREFERENCE_LIGHT || normalizedPreference === THEME_PREFERENCE_DARK) {
    return normalizedPreference;
  }

  return systemThemeMediaQuery?.matches ? THEME_PREFERENCE_DARK : THEME_PREFERENCE_LIGHT;
}

function getThemeLabel(theme) {
  return theme === THEME_PREFERENCE_LIGHT ? '浅色主题' : '深色主题';
}

function applyThemePreference() {
  const preference = normalizeThemePreference(state.settings?.themePreference);
  const resolvedTheme = getResolvedTheme(preference);
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = resolvedTheme;
}

function getCssColor(variableName, fallbackValue) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
  return value || fallbackValue;
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

function createClientRuleId(prefix = 'rule') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeMatcherInput(value) {
  return [...new Set(
    String(value || '')
      .split(/[\n,，；;]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  )];
}

function cloneRule(rule) {
  return {
    ...rule,
    appMatchers: [...(Array.isArray(rule?.appMatchers) ? rule.appMatchers : [])],
    domains: [...(Array.isArray(rule?.domains) ? rule.domains : [])]
  };
}

function cloneRuleList(items) {
  return (Array.isArray(items) ? items : []).map((item) => cloneRule(item));
}

function areRuleListsEqual(left, right) {
  return JSON.stringify(cloneRuleList(left)) === JSON.stringify(cloneRuleList(right));
}

function getAvailableCategories() {
  return Array.isArray(state.settings?.availableCategories) && state.settings.availableCategories.length
    ? state.settings.availableCategories
    : DEFAULT_CATEGORY_OPTIONS;
}

function getCategoryLabel(categoryId) {
  return getAvailableCategories().find((item) => item.id === categoryId)?.label || '';
}

function getItemCategoryLabel(item) {
  return item?.categoryLabel || getCategoryLabel(item?.categoryId) || '';
}

function prependCategoryLabel(baseText, item) {
  const categoryLabel = getItemCategoryLabel(item);
  if (!categoryLabel) {
    return baseText;
  }

  return baseText ? `${categoryLabel} · ${baseText}` : categoryLabel;
}

function createBlankServiceRule() {
  return {
    id: createClientRuleId('service'),
    serviceName: '',
    appMatchers: [],
    domains: []
  };
}

function createBlankCategoryRule() {
  return {
    id: createClientRuleId('category'),
    categoryId: getAvailableCategories()[0]?.id || 'work',
    appMatchers: [],
    domains: []
  };
}

function syncRuleDraftsFromSettings() {
  state.serviceRuleDrafts = cloneRuleList(state.settings?.customServiceRules);
  state.categoryRuleDrafts = cloneRuleList(state.settings?.categoryRules);
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
      existing.categoryId = item.categoryId || existing.categoryId || '';
      existing.categoryLabel = item.categoryLabel || existing.categoryLabel || getCategoryLabel(existing.categoryId);
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
        existing.categoryId = item.categoryId || existing.categoryId || '';
        existing.categoryLabel = item.categoryLabel || existing.categoryLabel || getCategoryLabel(existing.categoryId);
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

function getTrackingState(snapshot = state.snapshot) {
  const idleDetectionEnabled = state.settings?.idleDetectionEnabled !== false;
  const idleThresholdSeconds = clamp(Math.round(Number(state.settings?.idleThresholdSeconds) || 300), 60, 12 * 60 * 60);
  const pauseOnLockScreen = state.settings?.pauseOnLockScreen !== false;
  return snapshot?.meta?.trackingState || {
    isPaused: false,
    pausedAt: 0,
    pauseReasons: [],
    foregroundPaused: false,
    foregroundPausedAt: 0,
    foregroundPauseReasons: [],
    playbackPaused: false,
    playbackPausedAt: 0,
    playbackPauseReasons: [],
    manualPaused: false,
    manualPausedAt: 0,
    screenLocked: false,
    screenLockedAt: 0,
    pauseOnLockScreen,
    lockScreenPaused: false,
    idleDetectionEnabled,
    idleDetectionAvailable: true,
    idleThresholdSeconds,
    idleSeconds: 0,
    idlePaused: false,
    idlePausedAt: 0
  };
}

function formatIdleThreshold(seconds) {
  return formatDuration((Number(seconds) || 0) * 1000, 'short');
}

function getTrackingPauseReasonLabels(trackingState = getTrackingState(), reasons = trackingState.pauseReasons) {
  const labels = [];
  const reasonSet = new Set(Array.isArray(reasons) ? reasons : []);

  if (reasonSet.has('manual') || trackingState.manualPaused) {
    labels.push('手动暂停');
  }
  if (reasonSet.has('lock-screen') || trackingState.lockScreenPaused) {
    labels.push('Windows 已锁屏');
  }
  if (reasonSet.has('idle') || trackingState.idlePaused) {
    labels.push(`连续 ${formatIdleThreshold(trackingState.idleThresholdSeconds)} 没有键盘或鼠标输入`);
  }

  return labels;
}

function getTrackingStatusMessage(trackingState = getTrackingState()) {
  if (trackingState.playbackPaused) {
    const reasonLabels = getTrackingPauseReasonLabels(trackingState, trackingState.playbackPauseReasons);
    return {
      title: '统计已暂停',
      detail: `${reasonLabels.join('，')}，当前不会累计前台窗口、网页和音乐播放时长。`
    };
  }

  if (trackingState.foregroundPaused) {
    const reasonLabels = getTrackingPauseReasonLabels(trackingState, trackingState.foregroundPauseReasons);
    return {
      title: '前台统计已暂停',
      detail: `${reasonLabels.join('，')}，当前不累计前台窗口和网页；音乐播放仍会继续统计。`
    };
  }

  const details = [];
  if (state.settings?.idleDetectionEnabled !== false) {
    details.push(`连续 ${formatIdleThreshold(state.settings?.idleThresholdSeconds || 300)} 没有键盘或鼠标输入后，会暂停前台窗口和网页统计`);
  }
  if (state.settings?.pauseOnLockScreen !== false) {
    details.push('Windows 锁屏时会暂停全部统计');
  }

  return {
    title: '统计进行中',
    detail: details.length
      ? `当前正在采集使用数据，${details.join('，')}。`
      : '当前正在采集使用数据；如需临时停表，可以使用手动暂停。'
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
      detail: '网页访问会按站点归因到具体主机名，子域名会分开统计。',
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

  if (elements.overviewBridgeDot) {
    elements.overviewBridgeDot.classList.toggle('active', isConnected);
    elements.overviewBridgeDot.classList.toggle('warning', !isConnected);
  }

  if (elements.overviewBridgeStatus) {
    elements.overviewBridgeStatus.textContent = messages.summary;
  }

  if (elements.overviewBridgeCaption) {
    elements.overviewBridgeCaption.textContent = messages.detail;
  }
}

function formatClockTime(value) {
  const date = new Date(value);
  return `${padNumber(date.getHours())}:${padNumber(date.getMinutes())}`;
}

function formatTimelineSessionRange(session) {
  return `${formatClockTime(session.startedAt)} - ${formatClockTime(session.endedAt)}`;
}

function getTimelineSessionTitle(session) {
  if (session.trackingMode === 'playback') {
    return session.mediaTitle || session.label || session.appName || '音乐播放';
  }

  if (session.pageTitle) {
    return session.pageTitle;
  }

  return session.label || session.appName || session.host || '未知会话';
}

function getTimelineSessionSecondary(session) {
  const parts = [];

  if (session.trackingMode === 'playback') {
    if (session.mediaArtist) {
      parts.push(session.mediaArtist);
    }
    if (session.label && session.mediaTitle && session.label !== session.mediaTitle) {
      parts.push(session.label);
    }
    return parts.filter(Boolean).join(' · ');
  }

  if (session.url || session.kind === 'site') {
    parts.push(session.host || session.pageHost || session.label || '');
    if (session.appName && session.appName !== session.label) {
      parts.push(session.appName);
    }
    return parts.filter(Boolean).join(' · ');
  }

  const windowTitle = session.windowTitle || session.subtitle || '';
  if (windowTitle && windowTitle !== session.label) {
    parts.push(windowTitle);
  }
  if (session.processName && session.processName !== session.appName) {
    parts.push(session.processName);
  }

  return parts.filter(Boolean).join(' · ');
}

function getTimelineSessionKindLabel(session) {
  if (session.trackingMode === 'playback') {
    return formatTrackingSourceLabel(session.trackingSource);
  }

  if (session.url || session.kind === 'site') {
    return '网页会话';
  }

  return '前台窗口';
}

function buildTimelineTooltipRows(session, secondaryLabel, kindLabel, sessionColor) {
  const rows = [];

  if (kindLabel) {
    rows.push({
      chipColor: sessionColor,
      text: kindLabel
    });
  }

  if (secondaryLabel) {
    rows.push({ text: secondaryLabel });
  }

  if (session.isLive) {
    rows.push({ text: '当前正在进行' });
  }

  return rows;
}

function renderTimelineEmptyState(title, detail) {
  if (!elements.timelineBoard) {
    return;
  }

  const empty = document.createElement('div');
  empty.className = 'timeline-empty-state';

  const titleNode = document.createElement('strong');
  titleNode.className = 'timeline-empty-title';
  titleNode.textContent = title;

  empty.appendChild(titleNode);

  if (detail) {
    const detailNode = document.createElement('p');
    detailNode.className = 'timeline-empty-detail';
    detailNode.textContent = detail;
    empty.appendChild(detailNode);
  }

  elements.timelineBoard.appendChild(empty);
}

function buildTimelineLaneKey(session) {
  return [
    session?.key || '',
    session?.kind || '',
    session?.trackingMode || '',
    session?.trackingSource || ''
  ].join('\u0001');
}

function buildTimelineLayout(sessions) {
  const laneMap = new Map();
  const positioned = [...sessions]
    .sort((left, right) => (
      Number(left.startedAt) - Number(right.startedAt)
      || Number(left.endedAt) - Number(right.endedAt)
      || (left.key || '').localeCompare(right.key || '', 'en')
    ))
    .map((session) => {
      const laneKey = buildTimelineLaneKey(session);
      if (!laneMap.has(laneKey)) {
        laneMap.set(laneKey, laneMap.size);
      }

      return {
        ...session,
        laneIndex: laneMap.get(laneKey)
      };
    });

  return {
    laneCount: Math.max(laneMap.size, 1),
    sessions: positioned
  };
}

function renderTimelineBoard(sessions, dayKey) {
  if (!elements.timelineBoard) {
    return;
  }

  hideTimelineTooltip();
  elements.timelineBoard.replaceChildren();

  const layout = buildTimelineLayout(sessions);
  const totalWidth = TIMELINE_HOUR_WIDTH * 24;
  const totalHeight = layout.laneCount * TIMELINE_LANE_HEIGHT;
  const dayStart = new Date(`${dayKey}T00:00:00`).getTime();

  const grid = document.createElement('div');
  grid.className = 'timeline-grid';
  grid.style.setProperty('--timeline-hour-width', `${TIMELINE_HOUR_WIDTH}px`);

  const axis = document.createElement('div');
  axis.className = 'timeline-hour-axis';
  axis.style.width = `${totalWidth}px`;

  for (let hour = 0; hour < 24; hour += 1) {
    const label = document.createElement('div');
    label.className = 'timeline-hour-label';
    label.textContent = `${padNumber(hour)}:00`;
    axis.appendChild(label);
  }

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'timeline-canvas-wrap';

  const canvas = document.createElement('div');
  canvas.className = 'timeline-canvas';
  canvas.style.width = `${totalWidth}px`;
  canvas.style.height = `${totalHeight}px`;

  for (let laneIndex = 0; laneIndex < layout.laneCount; laneIndex += 1) {
    const row = document.createElement('div');
    row.className = 'timeline-lane-row';
    row.style.top = `${laneIndex * TIMELINE_LANE_HEIGHT}px`;
    row.style.height = `${TIMELINE_LANE_HEIGHT}px`;
    canvas.appendChild(row);
  }

  for (let hour = 0; hour < 24; hour += 1) {
    const slot = document.createElement('div');
    slot.className = 'timeline-hour-slot';
    slot.style.left = `${hour * TIMELINE_HOUR_WIDTH}px`;
    slot.style.width = `${TIMELINE_HOUR_WIDTH}px`;
    if (hour === 0) {
      slot.style.borderLeft = '0';
    }
    canvas.appendChild(slot);
  }

  if (dayKey === getLocalDayKey(new Date())) {
    const now = new Date();
    const minutesSinceStart = now.getHours() * 60 + now.getMinutes();
    const nowLine = document.createElement('div');
    nowLine.className = 'timeline-now-line';
    nowLine.style.left = `${(minutesSinceStart / 60) * TIMELINE_HOUR_WIDTH}px`;

    const nowLabel = document.createElement('span');
    nowLabel.className = 'timeline-now-label';
    nowLabel.textContent = `现在 ${formatClockTime(now)}`;

    nowLine.appendChild(nowLabel);
    canvas.appendChild(nowLine);
  }

  layout.sessions.forEach((session) => {
    const startMinutes = Math.max((Number(session.startedAt) - dayStart) / 60000, 0);
    const endMinutes = Math.min((Number(session.endedAt) - dayStart) / 60000, 24 * 60);
    const left = (startMinutes / 60) * TIMELINE_HOUR_WIDTH;
    const rawWidth = ((endMinutes - startMinutes) / 60) * TIMELINE_HOUR_WIDTH;
    const width = Math.max(rawWidth, TIMELINE_MIN_SESSION_WIDTH);
    const top = (session.laneIndex * TIMELINE_LANE_HEIGHT) + ((TIMELINE_LANE_HEIGHT - TIMELINE_CARD_HEIGHT) / 2);
    const titleLabel = getTimelineSessionTitle(session);
    const timeLabel = `${formatTimelineSessionRange(session)} · ${formatDuration(session.durationMs, 'short')}`;
    const secondaryLabel = getTimelineSessionSecondary(session);
    const kindLabel = getTimelineSessionKindLabel(session);
    const metaLabel = [secondaryLabel, kindLabel]
      .filter(Boolean)
      .join(' · ');
    const isCompact = width < TIMELINE_COMPACT_SESSION_WIDTH;
    const isCondensed = width < TIMELINE_CONDENSED_SESSION_WIDTH;

    const card = document.createElement('button');
    card.className = 'timeline-session-card';
    card.type = 'button';
    if (session.trackingMode === 'playback') {
      card.classList.add('playback');
    }
    if (session.isLive) {
      card.classList.add('live');
    }
    if (isCompact) {
      card.classList.add('compact');
    } else if (isCondensed) {
      card.classList.add('condensed');
    }
    card.style.top = `${top}px`;
    card.style.height = `${TIMELINE_CARD_HEIGHT}px`;
    card.style.left = `${left}px`;
    card.style.width = `${width}px`;
    const sessionColor = session.color || 'var(--accent)';
    const tooltipRows = buildTimelineTooltipRows(session, secondaryLabel, kindLabel, sessionColor);
    card.style.setProperty('--session-color', sessionColor);
    card.style.setProperty('--session-color-rgb', colorToRgbTriplet(sessionColor) || '28, 132, 255');
    card.setAttribute(
      'aria-label',
      [`查看 ${titleLabel} 的详情`, timeLabel, metaLabel, session.isLive ? '当前正在进行' : '']
        .filter(Boolean)
        .join('，')
    );
    card.addEventListener('click', () => openDetail(session.key));
    const showCardTooltip = () => {
      showTimelineTooltip({
        anchorRect: card.getBoundingClientRect(),
        titleText: titleLabel,
        timeText: timeLabel,
        rows: tooltipRows,
        sessionColor
      });
    };
    card.addEventListener('mouseenter', showCardTooltip);
    card.addEventListener('focus', showCardTooltip);
    card.addEventListener('mouseleave', hideTimelineTooltip);
    card.addEventListener('blur', hideTimelineTooltip);

    if (!isCompact) {
      const title = document.createElement('strong');
      title.className = 'timeline-session-title';
      title.textContent = titleLabel;
      card.appendChild(title);

      const time = document.createElement('span');
      time.className = 'timeline-session-time';
      time.textContent = timeLabel;
      card.appendChild(time);

    }

    if (session.isLive && !isCompact && !isCondensed) {
      const liveBadge = document.createElement('span');
      liveBadge.className = 'timeline-session-badge';
      liveBadge.textContent = '进行中';
      card.appendChild(liveBadge);
    }

    canvas.appendChild(card);
  });

  elements.timelineBoard.onscroll = hideTimelineTooltip;
  canvasWrap.appendChild(canvas);
  grid.append(axis, canvasWrap);
  elements.timelineBoard.appendChild(grid);
}

function renderTimelineScreen() {
  const snapshot = state.snapshot;
  if (!snapshot) {
    return;
  }

  ensureSelectedDayKey();
  const availableDays = snapshot.daily.availableDays || [];
  const currentIndex = availableDays.indexOf(state.selectedDayKey);
  const timeline = state.timeline?.dayKey === state.selectedDayKey ? state.timeline : null;
  const visibleSessions = timeline
    ? (timeline.sessions || []).filter((session) => isItemVisible(session.key))
    : [];
  const liveVisibleSessions = visibleSessions.filter((session) => session.isLive);
  const totalVisibleMs = visibleSessions.reduce((sum, session) => sum + (Number(session.durationMs) || 0), 0);

  elements.timelinePreviousDay.disabled = currentIndex <= 0;
  elements.timelineNextDay.disabled = currentIndex < 0 || currentIndex >= availableDays.length - 1;
  elements.timelineDateLabel.textContent = formatDayLabel(state.selectedDayKey);
  elements.timelineBoard.replaceChildren();

  if (elements.timelineDaySummary) {
    elements.timelineDaySummary.textContent = state.timelineLoading && !timeline
      ? '正在读取...'
      : (visibleSessions.length
        ? `共 ${visibleSessions.length} 段会话 · ${formatDuration(totalVisibleMs)}`
        : (timeline?.hasAggregatedData ? `已累计 ${formatDuration(timeline.totalMs)}` : '暂无会话'));
  }

  if (elements.timelineLiveDot) {
    elements.timelineLiveDot.classList.remove('active', 'warning');
    if (liveVisibleSessions.length) {
      elements.timelineLiveDot.classList.add('active');
    } else if (timeline?.hasAggregatedData && !timeline?.hasStoredSessions) {
      elements.timelineLiveDot.classList.add('warning');
    }
  }

  if (elements.timelineLiveStatus) {
    if (state.timelineLoading && !timeline) {
      elements.timelineLiveStatus.textContent = '正在读取所选日期的真实时间线...';
    } else if (liveVisibleSessions.length) {
      elements.timelineLiveStatus.textContent = `当前有 ${liveVisibleSessions.length} 段会话仍在进行中。`;
    } else if (timeline?.hasAggregatedData && !timeline?.hasStoredSessions) {
      elements.timelineLiveStatus.textContent = '这一天只有旧版聚合统计；真实时间线会从升级后新采集的数据开始积累。';
    } else if (timeline?.sessions?.length && !visibleSessions.length) {
      elements.timelineLiveStatus.textContent = '当前日期的会话都被隐藏了，可在设置 > 显示统计项中重新勾选。';
    } else {
      elements.timelineLiveStatus.textContent = '时间线按真实开始和结束时间排列，并保留前台窗口与播放会话的重叠关系。';
    }
  }

  if (state.timelineLoading && !timeline) {
    renderTimelineEmptyState('正在加载真实时间线', '会话明细会按实际开始和结束时间显示在这里。');
  } else if (visibleSessions.length) {
    renderTimelineBoard(visibleSessions, timeline.dayKey);
  } else if (timeline?.sessions?.length) {
    renderTimelineEmptyState('当前没有可见会话', '这一天的会话都被你隐藏了，重新勾选后就会显示。');
  } else if (timeline?.hasAggregatedData) {
    renderTimelineEmptyState('这一天还没有真实会话明细', '旧版本累计的总时长还保留着，但逐段时间线会从本次升级后继续积累。');
  } else {
    renderTimelineEmptyState('当前日期还没有采集到会话', '开始使用设备后，前台窗口、网页和播放记录会按真实时间顺序出现在这里。');
  }

  showScreen('timeline');

  if (!timeline && (!state.timelineLoading || state.timelineRequestedDayKey !== state.selectedDayKey)) {
    loadTimelineDay(state.selectedDayKey).catch(() => {});
  }
}

async function loadTimelineDay(dayKey, { force = false } = {}) {
  if (!dayKey) {
    return;
  }

  if (!force && state.timeline?.dayKey === dayKey && !state.timelineLoading) {
    return;
  }

  if (!force && state.timelineLoading && state.timelineRequestedDayKey === dayKey) {
    return;
  }

  const requestId = state.timelineRequestId + 1;
  state.timelineRequestId = requestId;
  state.timelineRequestedDayKey = dayKey;
  state.timelineLoading = true;

  if (state.activeScreen === 'timeline') {
    renderTimelineScreen();
  }

  try {
    const timeline = await window.usageApi.getTimeline(dayKey);
    if (state.timelineRequestId !== requestId) {
      return;
    }

    state.timeline = timeline || {
      dayKey,
      totalMs: 0,
      sessionCount: 0,
      availableDays: state.snapshot?.daily?.availableDays || [],
      hasStoredSessions: false,
      hasAggregatedData: false,
      sessions: []
    };
    if (state.timeline?.dayKey) {
      state.selectedDayKey = state.timeline.dayKey;
    }
  } finally {
    if (state.timelineRequestId !== requestId) {
      return;
    }

    state.timelineLoading = false;
    if (state.activeScreen === 'timeline') {
      renderTimelineScreen();
    }
  }
}

function renderTrackingPauseWarning(snapshot = state.snapshot) {
  if (!elements.trackingPauseWarning) {
    return;
  }

  const trackingState = getTrackingState(snapshot);
  const statusMessage = getTrackingStatusMessage(trackingState);
  elements.trackingPauseWarning.hidden = !trackingState.isPaused;

  if (elements.trackingPauseWarningTitle) {
    elements.trackingPauseWarningTitle.textContent = statusMessage.title;
  }

  if (elements.trackingPauseWarningText) {
    elements.trackingPauseWarningText.textContent = statusMessage.detail;
  }
}

function getRankingSubtitle(item) {
  let baseText = '';

  if (item.kind === 'service') {
    baseText = item.subtitle || item.host || item.appName || '';
  } else if (item.kind === 'site') {
    baseText = item.host || item.subtitle || item.appName || '';
  } else if (item.kind === 'page') {
    baseText = item.host || item.subtitle || item.url || item.appName || '';
  } else {
    baseText = item.subtitle || item.windowTitle || item.appName || '';
  }

  return prependCategoryLabel(baseText, item);
}

function getDetailSubtitle(detail) {
  if (!detail) {
    return '';
  }

  let baseText = '';
  if (detail.kind === 'service') {
    baseText = detail.host || detail.subtitle || detail.appName || '';
  } else if (detail.kind === 'site') {
    baseText = detail.host || detail.appName || '';
  } else if (detail.kind === 'page') {
    baseText = detail.host || detail.url || detail.appName || '';
  } else {
    baseText = detail.appName || '';
  }

  return prependCategoryLabel(baseText, detail);
}

function getPageDrilldownTitle(page) {
  return page.pageTitle || page.label || page.path || page.url || page.host || '页面';
}

function getPageDrilldownMeta(page) {
  return page.path || page.url || page.host || '';
}

function getSettingsItemMeta(item) {
  const parts = [];
  const categoryLabel = getItemCategoryLabel(item);

  if (categoryLabel) {
    parts.push(categoryLabel);
  }

  if (item.kind === 'service') {
    parts.push(item.host || item.appName || '服务');
  } else if (item.kind === 'site' || item.kind === 'page') {
    parts.push(item.host || item.appName || '网页');
  } else {
    parts.push(item.appName || item.processName || item.subtitle || '应用');
  }

  return parts.filter(Boolean).join(' · ');
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

function roundUpToStep(value, step) {
  const numericValue = Number(value);
  const numericStep = Number(step);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return 0;
  }

  if (!Number.isFinite(numericStep) || numericStep <= 0) {
    return Math.ceil(numericValue);
  }

  return Math.ceil(numericValue / numericStep) * numericStep;
}

function getChartScaleMax(values, minimum = 1, step = 1) {
  const numericValues = (values || [])
    .map((value) => Number(value) || 0)
    .filter((value) => value > 0);
  const maxValue = numericValues.length ? Math.max(...numericValues) : 0;
  return Math.max(minimum, roundUpToStep(maxValue, step), 1);
}

function getAverageChartLabels(scaleMax, averageValue, topLabel) {
  const labels = [{ value: 0, label: '0' }];
  const normalizedAverage = Math.max(0, Number(averageValue) || 0);

  if (normalizedAverage > 0 && normalizedAverage < scaleMax) {
    labels.push({ value: normalizedAverage, label: '平均' });
  }

  labels.push({ value: scaleMax, label: topLabel });
  return labels;
}

function formatChartHoursLabel(value) {
  const hours = Math.max(0, Number(value) || 0);

  if (!hours) {
    return '0';
  }

  const roundedHours = Math.abs(hours - Math.round(hours)) < 0.001
    ? Math.round(hours)
    : Math.round(hours * 10) / 10;
  return `${roundedHours} 小时`;
}

function formatChartMinutesLabel(value) {
  const minutes = Math.max(0, Math.round(Number(value) || 0));
  return minutes ? `${minutes} 分钟` : '0';
}

function drawBarChart({ canvas, bars, labels, yLabels, color, tooltip, onHover, scaleMax }) {
  const context = canvas.getContext('2d');
  const { ratio, width, height } = getCanvasMetrics(canvas);
  const gridColor = getCssColor('--chart-grid', 'rgba(255, 255, 255, 0.08)');
  const labelColor = getCssColor('--chart-label', 'rgba(255, 255, 255, 0.5)');
  const padding = { top: 14, right: 72, bottom: 30, left: 8 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const normalizedBars = (bars || []).map((value) => Math.max(0, Number(value) || 0));
  const resolvedScaleMax = Math.max(Number(scaleMax) || 0, ...normalizedBars, 1);
  const resolvedYLabels = (yLabels || [])
    .map((value) => {
      const numericValue = Number(value?.value);
      const hasNumericValue = Number.isFinite(numericValue);
      const resolvedValue = hasNumericValue
        ? Math.max(0, Math.min(numericValue, resolvedScaleMax))
        : Math.max(0, Math.min((Number(value?.ratio) || 0) * resolvedScaleMax, resolvedScaleMax));

      return {
        ...value,
        value: resolvedValue,
        ratio: resolvedScaleMax ? resolvedValue / resolvedScaleMax : 0
      };
    })
    .sort((left, right) => left.value - right.value);
  const step = chartWidth / Math.max(normalizedBars.length, 1);
  const barWidth = Math.min(14, step * 0.52);
  const hitAreas = [];

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.font = '12px Segoe UI';
  context.textBaseline = 'middle';

  context.strokeStyle = gridColor;
  context.lineWidth = 1;
  resolvedYLabels.forEach((value) => {
    const y = padding.top + chartHeight * (1 - value.ratio);
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right + 4, y);
    context.stroke();
    context.fillStyle = labelColor;
    context.textAlign = 'left';
    context.fillText(value.label, width - padding.right + 12, y);
  });

  normalizedBars.forEach((value, index) => {
    const x = padding.left + step * index + (step - barWidth) / 2;
    const scaledBarHeight = (value / resolvedScaleMax) * chartHeight;
    const barHeight = value > 0 ? Math.max(4, scaledBarHeight) : 0;
    const y = padding.top + chartHeight - barHeight;
    const label = typeof labels === 'function' ? labels(index) : labels[index];

    if (barHeight > 0) {
      context.fillStyle = color;
      context.beginPath();
      context.roundRect(x, y, barWidth, barHeight, 6);
      context.fill();
    }

    if (label) {
      context.fillStyle = labelColor;
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

  const listNode = createTooltipList(rows);
  if (listNode) {
    tooltip.appendChild(listNode);
  }

  tooltip.classList.remove('hidden');
  const relativeX = (chartPoint.x + chartPoint.width / 2) / rect.width;
  const relativeY = chartPoint.y / rect.height;
  tooltip.style.left = `${relativeX * 100}%`;
  tooltip.style.top = `${Math.max(relativeY * 100 - 4, 15)}%`;
}

function renderTooltipChip(chipNode, row) {
  chipNode.className = 'tooltip-chip';
  chipNode.setAttribute('aria-hidden', 'true');

  if (row.item) {
    setAvatarContent(chipNode, row.item, state.iconCache.get(row.item.key) || null);

    if (!state.iconCache.has(row.item.key)) {
      requestIcons([row.item])
        .then(() => {
          if (!chipNode.isConnected) {
            return;
          }

          setAvatarContent(chipNode, row.item, state.iconCache.get(row.item.key) || null);
        })
        .catch(() => {});
    }
    return;
  }

  chipNode.textContent = row.chipText || '';
  if (row.chipColor) {
    chipNode.style.background = row.chipColor;
  }
}

function createTooltipList(rows) {
  if (!rows.length) {
    return null;
  }

  const listNode = document.createElement('div');
  listNode.className = 'tooltip-list';

  rows.forEach((row) => {
    const rowNode = document.createElement('div');
    rowNode.className = 'tooltip-row';

    if (row.item || row.chipText || row.chipColor) {
      const chipNode = document.createElement('span');
      renderTooltipChip(chipNode, row);
      rowNode.appendChild(chipNode);
    }

    const textNode = document.createElement('span');
    textNode.textContent = row.text;
    rowNode.appendChild(textNode);
    listNode.appendChild(rowNode);
  });

  return listNode;
}

function getTimelineTooltipElement() {
  let tooltip = document.getElementById('timeline-session-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'timeline-session-tooltip';
    tooltip.className = 'chart-tooltip timeline-session-tooltip hidden';
    document.body.appendChild(tooltip);
  }

  return tooltip;
}

function hideTimelineTooltip() {
  const tooltip = document.getElementById('timeline-session-tooltip');
  if (!tooltip) {
    return;
  }

  tooltip.classList.add('hidden');
  tooltip.classList.remove('below');
}

function showTimelineTooltip({ anchorRect, titleText, timeText, rows = [], sessionColor }) {
  if (!anchorRect) {
    return;
  }

  const tooltip = getTimelineTooltipElement();
  const accentRgb = colorToRgbTriplet(sessionColor) || '28, 132, 255';
  tooltip.replaceChildren();
  tooltip.style.setProperty('--timeline-tooltip-accent', sessionColor || 'var(--accent)');
  tooltip.style.setProperty('--timeline-tooltip-accent-rgb', accentRgb);

  const valueNode = document.createElement('span');
  valueNode.className = 'tooltip-value';
  valueNode.textContent = titleText;
  tooltip.appendChild(valueNode);

  if (timeText) {
    const labelNode = document.createElement('span');
    labelNode.className = 'tooltip-label';
    labelNode.textContent = timeText;
    tooltip.appendChild(labelNode);
  }

  const listNode = createTooltipList(rows);
  if (listNode) {
    tooltip.appendChild(listNode);
  }

  tooltip.classList.remove('hidden');
  tooltip.classList.remove('below');
  tooltip.style.left = '12px';
  tooltip.style.top = '12px';

  const tooltipRect = tooltip.getBoundingClientRect();
  const margin = 12;
  const gap = 14;
  let left = anchorRect.left + (anchorRect.width / 2) - (tooltipRect.width / 2);
  left = Math.max(margin, Math.min(left, window.innerWidth - tooltipRect.width - margin));

  let top = anchorRect.top - tooltipRect.height - gap;
  if (top < margin) {
    top = Math.min(anchorRect.bottom + gap, window.innerHeight - tooltipRect.height - margin);
    tooltip.classList.add('below');
  }

  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
}

function updateHeader() {
  const isDetail = state.activeScreen === 'detail';
  elements.tabRow.classList.toggle('hidden-nav', isDetail);
  elements.backButton.classList.toggle('inactive', !isDetail);
  elements.screenTitle.textContent = isDetail
    ? (state.detail?.label || '详情')
    : (state.activeScreen === 'settings'
      ? '设置'
      : (state.activeScreen === 'timeline' ? '时间线' : '使用统计'));
}

function updateTopTabs() {
  const isSettings = state.activeScreen === 'settings';
  const isTimeline = state.activeScreen === 'timeline';
  elements.rangeTabs.forEach((tab) => {
    if (tab.id === 'settings-button') {
      tab.classList.toggle('active', isSettings);
      return;
    }

    if (tab.id === 'timeline-button') {
      tab.classList.toggle('active', isTimeline);
      return;
    }

    tab.classList.toggle('active', !isSettings && !isTimeline && tab.dataset.range === state.selectedRange);
  });
}

function updateSettingsSubnav() {
  const isSettings = state.activeScreen === 'settings';
  const activeSection = normalizeSettingsSection(state.selectedSettingsSection);
  state.selectedSettingsSection = activeSection;

  if (elements.settingsSubnav) {
    elements.settingsSubnav.hidden = !isSettings;
  }

  elements.settingsSectionTabs.forEach((button) => {
    const isActive = isSettings && button.dataset.settingsSection === activeSection;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });

  elements.settingsSectionPanels.forEach((panel) => {
    panel.hidden = panel.dataset.settingsSectionPanel !== activeSection;
  });
}

function showScreen(screen) {
  state.activeScreen = screen;
  hideTimelineTooltip();
  elements.overviewScreen.classList.toggle('active', screen === 'overview');
  elements.timelineScreen.classList.toggle('active', screen === 'timeline');
  elements.detailScreen.classList.toggle('active', screen === 'detail');
  elements.settingsScreen.classList.toggle('active', screen === 'settings');
  updateTopTabs();
  updateHeader();
  updateSettingsSubnav();
  if (screen === 'overview') {
    queueOverviewRankingCardHeightSync();
  } else {
    clearOverviewRankingCardHeight();
  }
}

function renderSettingsState() {
  const snapshot = state.snapshot;
  const trackingState = getTrackingState(snapshot);
  const trackingStatusMessage = getTrackingStatusMessage(trackingState);
  const enabled = Boolean(state.settings?.autoLaunchEnabled);
  const idleDetectionEnabled = state.settings?.idleDetectionEnabled !== false;
  const idleThresholdSeconds = clamp(Math.round(Number(state.settings?.idleThresholdSeconds) || 300), 60, 12 * 60 * 60);
  const pauseOnLockScreen = state.settings?.pauseOnLockScreen !== false;
  const autoBackupEnabled = Boolean(state.settings?.autoBackupEnabled);
  const autoBackupIntervalMinutes = Number(state.settings?.autoBackupIntervalMinutes) || 1440;
  const autoBackupParts = getAutoBackupIntervalParts(autoBackupIntervalMinutes);
  const lastAutoBackupAt = formatDateTime(state.settings?.lastAutoBackupAt);
  const nextAutoBackupAt = formatDateTime(state.settings?.nextAutoBackupAt);
  const autoBackupDirectory = state.settings?.autoBackupDirectory || '';
  const autoBackupError = state.settings?.lastAutoBackupError || '';
  const closeAction = state.settings?.closeWindowAction || 'tray';
  const themePreference = normalizeThemePreference(state.settings?.themePreference);
  const resolvedTheme = getResolvedTheme(themePreference);
  const backupBusyText = state.backupBusy
    ? (state.backupBusyAction === 'import' ? '正在导入并恢复备份...' : '正在导出备份...')
    : state.backupStatus.text;
  const closeActionLabels = {
    exit: '关闭窗口时将直接退出应用',
    tray: '关闭窗口时将最小化到系统托盘',
    ask: '关闭窗口时每次都询问'
  };

  elements.themeStatusDot.classList.add('active');
  elements.themeStatusText.textContent = themePreference === THEME_PREFERENCE_SYSTEM
    ? `当前跟随系统，已应用${getThemeLabel(resolvedTheme)}`
    : `当前已固定为${getThemeLabel(resolvedTheme)}`;
  elements.themePreferenceButtons.forEach((button) => {
    const isActive = button.dataset.themePreference === themePreference;
    button.classList.toggle('active', isActive);
    button.disabled = state.updatingThemePreference;
    button.setAttribute('aria-checked', isActive ? 'true' : 'false');
  });

  elements.autoLaunchSwitch.classList.toggle('active', enabled);
  elements.autoLaunchDot.classList.toggle('active', enabled);
  elements.autoLaunchStatus.textContent = enabled ? '已开启开机自启动' : '未开启开机自启动';
  elements.autoLaunchToggle.setAttribute('aria-checked', enabled ? 'true' : 'false');

  elements.manualPauseSwitch.classList.toggle('active', Boolean(trackingState.manualPaused));
  elements.manualPauseDot.classList.toggle('active', Boolean(trackingState.manualPaused));
  elements.manualPauseDot.classList.toggle('warning', Boolean(trackingState.isPaused && !trackingState.manualPaused));
  elements.manualPauseStatus.textContent = trackingState.manualPaused
    ? '已手动暂停统计'
    : (trackingState.isPaused ? trackingStatusMessage.detail : '当前未手动暂停');
  elements.manualPauseToggle.setAttribute('aria-checked', trackingState.manualPaused ? 'true' : 'false');
  elements.manualPauseToggle.disabled = state.updatingManualPause;

  elements.idleDetectionSwitch.classList.toggle('active', idleDetectionEnabled);
  elements.idleDetectionDot.classList.toggle('active', idleDetectionEnabled && !trackingState.idlePaused);
  elements.idleDetectionDot.classList.toggle('warning', Boolean(trackingState.idlePaused));
  elements.idleDetectionToggle.setAttribute('aria-checked', idleDetectionEnabled ? 'true' : 'false');
  elements.idleDetectionToggle.disabled = state.updatingTrackingProtection;
  elements.idleThresholdValue.value = String(Math.max(Math.round(idleThresholdSeconds / 60), 1));
  elements.idleThresholdValue.disabled = state.updatingTrackingProtection || !idleDetectionEnabled;

  if (!idleDetectionEnabled) {
    elements.idleDetectionStatus.textContent = '空闲检测已关闭';
  } else if (!trackingState.idleDetectionAvailable) {
    elements.idleDetectionStatus.textContent = '当前环境暂时不可用空闲检测';
  } else if (trackingState.idlePaused) {
    elements.idleDetectionStatus.textContent = `连续 ${formatIdleThreshold(idleThresholdSeconds)} 没有键盘或鼠标输入，当前暂停前台窗口和网页；音乐播放仍继续统计`;
  } else {
    elements.idleDetectionStatus.textContent = `连续 ${formatIdleThreshold(idleThresholdSeconds)} 没有键盘或鼠标输入后，自动暂停前台窗口和网页`;
  }

  elements.lockScreenPauseSwitch.classList.toggle('active', pauseOnLockScreen);
  elements.lockScreenPauseDot.classList.toggle('active', pauseOnLockScreen && !trackingState.lockScreenPaused);
  elements.lockScreenPauseDot.classList.toggle('warning', Boolean(trackingState.lockScreenPaused));
  elements.lockScreenPauseToggle.setAttribute('aria-checked', pauseOnLockScreen ? 'true' : 'false');
  elements.lockScreenPauseToggle.disabled = state.updatingTrackingProtection;

  if (!pauseOnLockScreen) {
    elements.lockScreenPauseStatus.textContent = '锁屏暂停已关闭';
  } else if (trackingState.lockScreenPaused) {
    elements.lockScreenPauseStatus.textContent = 'Windows 当前已锁屏，前台窗口、网页和音乐播放都已暂停统计';
  } else {
    elements.lockScreenPauseStatus.textContent = 'Windows 锁屏时会暂停前台窗口、网页和音乐播放';
  }

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

  renderBrowserExtensionStatus(snapshot);
}

function joinMatcherValues(values) {
  return (Array.isArray(values) ? values : []).join(', ');
}

function createRuleField({ labelText, input, full = false }) {
  const field = document.createElement('label');
  field.className = `setting-rule-field${full ? ' full' : ''}`;

  const label = document.createElement('span');
  label.className = 'setting-rule-field-label';
  label.textContent = labelText;

  field.appendChild(label);
  field.appendChild(input);
  return field;
}

function renderServiceRuleSettings() {
  const drafts = cloneRuleList(state.serviceRuleDrafts);
  const storedRules = cloneRuleList(state.settings?.customServiceRules);
  const dirty = !areRuleListsEqual(drafts, storedRules);

  if (!drafts.length) {
    elements.serviceRulesSummary.textContent = dirty
      ? '已清空全部服务合并规则，保存后会生效。'
      : '还没有自定义服务合并规则。';
  } else {
    elements.serviceRulesSummary.textContent = dirty
      ? `已编辑 ${drafts.length} 条服务合并规则，尚未保存。`
      : `已配置 ${drafts.length} 条服务合并规则。`;
  }

  elements.addServiceRuleButton.disabled = state.updatingServiceRules;
  elements.saveServiceRulesButton.disabled = state.updatingServiceRules || !dirty;
  elements.saveServiceRulesButton.textContent = state.updatingServiceRules ? '保存中...' : '保存规则';
  elements.serviceRuleList.replaceChildren();

  if (!drafts.length) {
    const empty = document.createElement('div');
    empty.className = 'setting-rule-empty';
    empty.textContent = '例如把 Slack 应用和 `slack.com` 合并成一个服务，保存后排行和详情会一起归并。';
    elements.serviceRuleList.appendChild(empty);
    return;
  }

  drafts.forEach((rule, index) => {
    const card = document.createElement('div');
    card.className = 'setting-rule-card';

    const grid = document.createElement('div');
    grid.className = 'setting-rule-grid';

    const serviceNameInput = document.createElement('input');
    serviceNameInput.className = 'setting-rule-input';
    serviceNameInput.type = 'text';
    serviceNameInput.placeholder = '例如 Slack';
    serviceNameInput.value = rule.serviceName || '';
    serviceNameInput.disabled = state.updatingServiceRules;
    serviceNameInput.addEventListener('change', () => {
      state.serviceRuleDrafts[index].serviceName = serviceNameInput.value.trim();
      renderSettingsScreen();
    });
    grid.appendChild(createRuleField({
      labelText: '服务名称',
      input: serviceNameInput
    }));

    const domainsInput = document.createElement('input');
    domainsInput.className = 'setting-rule-input';
    domainsInput.type = 'text';
    domainsInput.placeholder = '例如 slack.com, app.slack.com';
    domainsInput.value = joinMatcherValues(rule.domains);
    domainsInput.disabled = state.updatingServiceRules;
    domainsInput.addEventListener('change', () => {
      state.serviceRuleDrafts[index].domains = normalizeMatcherInput(domainsInput.value);
      renderSettingsScreen();
    });
    grid.appendChild(createRuleField({
      labelText: '域名',
      input: domainsInput
    }));

    const appMatchersInput = document.createElement('input');
    appMatchersInput.className = 'setting-rule-input';
    appMatchersInput.type = 'text';
    appMatchersInput.placeholder = '例如 Slack, slack.exe';
    appMatchersInput.value = joinMatcherValues(rule.appMatchers);
    appMatchersInput.disabled = state.updatingServiceRules;
    appMatchersInput.addEventListener('change', () => {
      state.serviceRuleDrafts[index].appMatchers = normalizeMatcherInput(appMatchersInput.value);
      renderSettingsScreen();
    });
    grid.appendChild(createRuleField({
      labelText: '桌面应用',
      input: appMatchersInput,
      full: true
    }));

    card.appendChild(grid);

    const hint = document.createElement('div');
    hint.className = 'setting-rule-hint';
    hint.textContent = '应用名和域名都支持用逗号分隔；填 app.slack.com 只匹配该子域名，填 slack.com 会匹配整个站点。';
    card.appendChild(hint);

    const actions = document.createElement('div');
    actions.className = 'setting-rule-actions';

    const moveUpButton = document.createElement('button');
    moveUpButton.className = 'text-button inline-button';
    moveUpButton.type = 'button';
    moveUpButton.textContent = '上移';
    moveUpButton.disabled = state.updatingServiceRules || index === 0;
    moveUpButton.addEventListener('click', () => {
      const [movedRule] = state.serviceRuleDrafts.splice(index, 1);
      state.serviceRuleDrafts.splice(index - 1, 0, movedRule);
      renderSettingsScreen();
    });
    actions.appendChild(moveUpButton);

    const moveDownButton = document.createElement('button');
    moveDownButton.className = 'text-button inline-button';
    moveDownButton.type = 'button';
    moveDownButton.textContent = '下移';
    moveDownButton.disabled = state.updatingServiceRules || index === drafts.length - 1;
    moveDownButton.addEventListener('click', () => {
      const [movedRule] = state.serviceRuleDrafts.splice(index, 1);
      state.serviceRuleDrafts.splice(index + 1, 0, movedRule);
      renderSettingsScreen();
    });
    actions.appendChild(moveDownButton);

    const deleteButton = document.createElement('button');
    deleteButton.className = 'text-button inline-button';
    deleteButton.type = 'button';
    deleteButton.textContent = '删除';
    deleteButton.disabled = state.updatingServiceRules;
    deleteButton.addEventListener('click', () => {
      state.serviceRuleDrafts.splice(index, 1);
      renderSettingsScreen();
    });
    actions.appendChild(deleteButton);

    card.appendChild(actions);
    elements.serviceRuleList.appendChild(card);
  });
}

function renderCategoryRuleSettings() {
  const drafts = cloneRuleList(state.categoryRuleDrafts);
  const storedRules = cloneRuleList(state.settings?.categoryRules);
  const dirty = !areRuleListsEqual(drafts, storedRules);

  if (!drafts.length) {
    elements.categoryRulesSummary.textContent = dirty
      ? '已清空全部分类规则，保存后会生效。'
      : '还没有自定义分类规则。';
  } else {
    elements.categoryRulesSummary.textContent = dirty
      ? `已编辑 ${drafts.length} 条分类规则，尚未保存。`
      : `已配置 ${drafts.length} 条分类规则。`;
  }

  elements.addCategoryRuleButton.disabled = state.updatingCategoryRules;
  elements.saveCategoryRulesButton.disabled = state.updatingCategoryRules || !dirty;
  elements.saveCategoryRulesButton.textContent = state.updatingCategoryRules ? '保存中...' : '保存规则';
  elements.categoryRuleList.replaceChildren();

  if (!drafts.length) {
    const empty = document.createElement('div');
    empty.className = 'setting-rule-empty';
    empty.textContent = '例如把 GitHub、VS Code 归到“工作”，把 bilibili 归到“娱乐”。';
    elements.categoryRuleList.appendChild(empty);
    return;
  }

  drafts.forEach((rule, index) => {
    const card = document.createElement('div');
    card.className = 'setting-rule-card';

    const grid = document.createElement('div');
    grid.className = 'setting-rule-grid';

    const categorySelect = document.createElement('select');
    categorySelect.className = 'setting-rule-input';
    categorySelect.disabled = state.updatingCategoryRules;
    getAvailableCategories().forEach((category) => {
      const option = document.createElement('option');
      option.value = category.id;
      option.textContent = category.label;
      option.selected = category.id === rule.categoryId;
      categorySelect.appendChild(option);
    });
    categorySelect.addEventListener('change', () => {
      state.categoryRuleDrafts[index].categoryId = categorySelect.value;
      renderSettingsScreen();
    });
    grid.appendChild(createRuleField({
      labelText: '分类',
      input: categorySelect
    }));

    const domainsInput = document.createElement('input');
    domainsInput.className = 'setting-rule-input';
    domainsInput.type = 'text';
    domainsInput.placeholder = '例如 github.com, bilibili.com';
    domainsInput.value = joinMatcherValues(rule.domains);
    domainsInput.disabled = state.updatingCategoryRules;
    domainsInput.addEventListener('change', () => {
      state.categoryRuleDrafts[index].domains = normalizeMatcherInput(domainsInput.value);
      renderSettingsScreen();
    });
    grid.appendChild(createRuleField({
      labelText: '域名',
      input: domainsInput
    }));

    const appMatchersInput = document.createElement('input');
    appMatchersInput.className = 'setting-rule-input';
    appMatchersInput.type = 'text';
    appMatchersInput.placeholder = '例如 Slack, Visual Studio Code';
    appMatchersInput.value = joinMatcherValues(rule.appMatchers);
    appMatchersInput.disabled = state.updatingCategoryRules;
    appMatchersInput.addEventListener('change', () => {
      state.categoryRuleDrafts[index].appMatchers = normalizeMatcherInput(appMatchersInput.value);
      renderSettingsScreen();
    });
    grid.appendChild(createRuleField({
      labelText: '应用 / 服务名称',
      input: appMatchersInput,
      full: true
    }));

    card.appendChild(grid);

    const hint = document.createElement('div');
    hint.className = 'setting-rule-hint';
    hint.textContent = '先匹配到的分类规则会优先生效；域名支持精确子域名和根域名，合并后的服务名称也可以直接在这里匹配。';
    card.appendChild(hint);

    const actions = document.createElement('div');
    actions.className = 'setting-rule-actions';

    const moveUpButton = document.createElement('button');
    moveUpButton.className = 'text-button inline-button';
    moveUpButton.type = 'button';
    moveUpButton.textContent = '上移';
    moveUpButton.disabled = state.updatingCategoryRules || index === 0;
    moveUpButton.addEventListener('click', () => {
      const [movedRule] = state.categoryRuleDrafts.splice(index, 1);
      state.categoryRuleDrafts.splice(index - 1, 0, movedRule);
      renderSettingsScreen();
    });
    actions.appendChild(moveUpButton);

    const moveDownButton = document.createElement('button');
    moveDownButton.className = 'text-button inline-button';
    moveDownButton.type = 'button';
    moveDownButton.textContent = '下移';
    moveDownButton.disabled = state.updatingCategoryRules || index === drafts.length - 1;
    moveDownButton.addEventListener('click', () => {
      const [movedRule] = state.categoryRuleDrafts.splice(index, 1);
      state.categoryRuleDrafts.splice(index + 1, 0, movedRule);
      renderSettingsScreen();
    });
    actions.appendChild(moveDownButton);

    const deleteButton = document.createElement('button');
    deleteButton.className = 'text-button inline-button';
    deleteButton.type = 'button';
    deleteButton.textContent = '删除';
    deleteButton.disabled = state.updatingCategoryRules;
    deleteButton.addEventListener('click', () => {
      state.categoryRuleDrafts.splice(index, 1);
      renderSettingsScreen();
    });
    actions.appendChild(deleteButton);

    card.appendChild(actions);
    elements.categoryRuleList.appendChild(card);
  });
}

function renderItemVisibilitySettings() {
  const items = getAllKnownItems();
  const hiddenKeys = getHiddenItemKeySet();
  const selectedItems = items.filter((item) => !hiddenKeys.has(item.key));
  const unselectedItems = items.filter((item) => hiddenKeys.has(item.key));
  const selectedCount = selectedItems.length;

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

  const createItemRow = (item) => {
    const fragment = elements.settingItemTemplate.content.cloneNode(true);
    const row = fragment.querySelector('.setting-check-item');
    const input = fragment.querySelector('.setting-checkbox-input');
    const avatar = fragment.querySelector('.setting-item-avatar');
    const name = fragment.querySelector('.setting-item-name');
    const meta = fragment.querySelector('.setting-item-meta');
    const checked = !hiddenKeys.has(item.key);

    row.dataset.itemKey = item.key;
    input.checked = checked;
    input.disabled = state.updatingHiddenItems;
    input.dataset.itemKey = item.key;
    input.setAttribute('aria-label', `切换 ${item.label} 的显示状态`);
    name.textContent = item.label;
    meta.textContent = getSettingsItemMeta(item);
    setAvatarContent(avatar, item, state.iconCache.get(item.key) || null);

    input.addEventListener('change', () => {
      updateItemVisibility(item.key, input.checked).catch(() => {
        input.checked = !input.checked;
      });
    });

    return fragment;
  };

  const createItemGroup = (title, groupItems, emptyText) => {
    const section = document.createElement('section');
    section.className = 'setting-check-group';

    const header = document.createElement('div');
    header.className = 'setting-check-group-header';

    const heading = document.createElement('h4');
    heading.className = 'setting-check-group-title';
    heading.textContent = title;

    const count = document.createElement('span');
    count.className = 'setting-check-group-count';
    count.textContent = `${groupItems.length} 项`;

    header.append(heading, count);

    const list = document.createElement('div');
    list.className = 'setting-check-group-list';

    if (!groupItems.length) {
      const empty = document.createElement('div');
      empty.className = 'setting-check-group-empty';
      empty.textContent = emptyText;
      list.appendChild(empty);
    } else {
      groupItems.forEach((item) => {
        list.appendChild(createItemRow(item));
      });
    }

    section.append(header, list);
    return section;
  };

  elements.itemVisibilityList.append(
    createItemGroup('已勾选项目', selectedItems, '当前没有已勾选的统计项。'),
    createItemGroup('未勾选项目', unselectedItems, '当前没有未勾选的统计项。')
  );

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
  const currentIndex = snapshot.daily.availableDays.indexOf(state.selectedDayKey);

  elements.previousDay.style.visibility = isDaily ? 'visible' : 'hidden';
  elements.nextDay.style.visibility = isDaily ? 'visible' : 'hidden';
  elements.previousDay.disabled = !isDaily || currentIndex <= 0;
  elements.nextDay.disabled = !isDaily || currentIndex < 0 || currentIndex >= snapshot.daily.availableDays.length - 1;
  elements.dateLabel.textContent = isDaily ? formatDayLabel(state.selectedDayKey) : formatWeekRange(weekly.dayKeys);
  elements.chartSectionTitle.textContent = isDaily ? '使用时长（截至今天）' : '使用时长（近 7 天）';
  elements.summaryDuration.textContent = isDaily ? formatDuration(activeDay.totalMs) : formatDuration(weekly.averageMs, 'short');
  elements.summarySubtitle.textContent = isDaily ? '' : `总时长：${formatDuration(weekly.totalMs)}`;
  elements.rankingSummary.textContent = rankingItems.length
    ? `共 ${rankingItems.length} 项`
    : '等待采集数据';

  renderTrackingPauseWarning(snapshot);
  renderRanking(rankingItems, totalMs);
  renderSettingsState();

  if (isDaily) {
    const hourly = activeDay.hourly;
    const hourlyBars = hourly.map((value) => Math.round(value / 60000));
    drawBarChart({
      canvas: elements.chartCanvas,
      bars: hourlyBars,
      labels: (index) => ({ 0: '0 时', 6: '6 时', 12: '12 时', 18: '18 时' }[index] || ''),
      yLabels: [
        { value: 0, label: '0' },
        { value: 30, label: '30 分钟' },
        { value: 60, label: '60 分钟' }
      ],
      scaleMax: 60,
      color: '#1a8dff',
      tooltip: elements.chartTooltip,
      onHover: (hit, rect) => {
        const topItems = activeDay.items
          .map((item) => ({
            item,
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
              item: item.item,
              text: `${item.item.label} ${item.minutes}分钟`
            }))
          }
        );
      }
    });
  } else {
    const weeklyBars = weekly.dailyTotals.map((item) => Math.round((item.totalMs / 3600000) * 10) / 10);
    const weeklyAverageHours = weekly.averageMs / 3600000;
    const weeklyScaleMax = getChartScaleMax([...weeklyBars, weeklyAverageHours], 12, 2);

    drawBarChart({
      canvas: elements.chartCanvas,
      bars: weeklyBars,
      labels: weekly.dayKeys.map((dayKey) => weekdayLabel(dayKey)),
      yLabels: getAverageChartLabels(weeklyScaleMax, weeklyAverageHours, formatChartHoursLabel(weeklyScaleMax)),
      scaleMax: weeklyScaleMax,
      color: '#1a8dff',
      tooltip: elements.chartTooltip,
      onHover: (hit, rect) => {
        const dayKey = weekly.dayKeys[hit.index];
        const topItems = weekly.items
          .map((item) => ({
            item,
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
              item: item.item,
              text: `${item.item.label} ${formatDuration(item.duration, 'short')}`
            }))
          }
        );
      }
    });
  }

  showScreen('overview');
}

function renderPageDrilldown(detail) {
  if (!elements.detailPagesSection || !elements.detailPagesList || !elements.detailPagesSummary) {
    return;
  }

  const pages = Array.isArray(detail?.pageBreakdown) ? detail.pageBreakdown : [];
  const visiblePages = pages.slice(0, 12);
  elements.detailPagesSection.hidden = !visiblePages.length;
  elements.detailPagesList.replaceChildren();

  if (!visiblePages.length) {
    return;
  }

  elements.detailPagesSummary.textContent = pages.length > visiblePages.length
    ? `显示前 ${visiblePages.length} 个页面`
    : `共 ${pages.length} 个页面`;

  visiblePages.forEach((page) => {
    const row = document.createElement('div');
    row.className = 'detail-page-item';

    const copy = document.createElement('div');
    copy.className = 'detail-page-copy';

    const title = document.createElement('div');
    title.className = 'detail-page-title';
    title.textContent = getPageDrilldownTitle(page);

    const meta = document.createElement('div');
    meta.className = 'detail-page-meta';
    meta.textContent = getPageDrilldownMeta(page);

    const submeta = document.createElement('div');
    submeta.className = 'detail-page-submeta';
    submeta.textContent = page.todayMs
      ? `今天 ${formatDuration(page.todayMs, 'short')} · 最近访问 ${formatDateTime(page.lastSeenAt)}`
      : `最近访问 ${formatDateTime(page.lastSeenAt) || '未知'}`;

    copy.appendChild(title);
    if (meta.textContent) {
      copy.appendChild(meta);
    }
    copy.appendChild(submeta);

    const duration = document.createElement('div');
    duration.className = 'detail-page-duration';
    duration.textContent = formatDuration(page.totalMs, 'short');

    row.appendChild(copy);
    row.appendChild(duration);
    elements.detailPagesList.appendChild(row);
  });
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
        ['分类', getItemCategoryLabel(detail) || '未分类'],
        ['服务', detail.label],
        ['站点域名', detail.host],
        ['最近内容标题', detail.pageTitle || detail.windowTitle],
        ['最近网页地址', detail.url],
        ['本地应用可执行文件', detail.executablePath]
      ]
    : detail.kind === 'site'
    ? [
        ['分类', getItemCategoryLabel(detail) || '未分类'],
        ['应用', detail.appName],
        ['站点域名', detail.host],
        ['最近网页标题', detail.pageTitle || detail.windowTitle],
        ['最近网页地址', detail.url],
        ['可执行文件', detail.executablePath]
      ]
    : [
        ['分类', getItemCategoryLabel(detail) || '未分类'],
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

  renderPageDrilldown(detail);

  const detailDayBars = detail.todayHourly.map((value) => Math.round(value / 60000));
  drawBarChart({
    canvas: elements.detailDayChart,
    bars: detailDayBars,
    labels: (index) => ({ 0: '0', 6: '6', 12: '12', 18: '18' }[index] || ''),
    yLabels: [
      { value: 0, label: '0' },
      { value: 30, label: '30 分钟' },
      { value: 60, label: '60 分钟' }
    ],
    scaleMax: 60,
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

  const detailWeekBars = detail.lastSevenDays.map((item) => Math.round(item.totalMs / 60000));
  const detailWeekAverageMinutes = detail.averageMs / 60000;
  const detailWeekScaleMax = getChartScaleMax([...detailWeekBars, detailWeekAverageMinutes], 120, 30);

  drawBarChart({
    canvas: elements.detailWeekChart,
    bars: detailWeekBars,
    labels: detail.lastSevenDays.map((item) => weekdayLabel(item.dayKey)),
    yLabels: getAverageChartLabels(detailWeekScaleMax, detailWeekAverageMinutes, formatChartMinutesLabel(detailWeekScaleMax)),
    scaleMax: detailWeekScaleMax,
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
  renderServiceRuleSettings();
  renderCategoryRuleSettings();
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
    applyThemePreference();
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

async function updateTrackingProtectionSettings(partialSettings = {}) {
  if (state.updatingTrackingProtection) {
    return;
  }

  const previousSettings = state.settings || {
    idleDetectionEnabled: true,
    idleThresholdSeconds: 300,
    pauseOnLockScreen: true
  };
  const nextSettings = {
    idleDetectionEnabled: Object.prototype.hasOwnProperty.call(partialSettings, 'idleDetectionEnabled')
      ? Boolean(partialSettings.idleDetectionEnabled)
      : previousSettings.idleDetectionEnabled !== false,
    idleThresholdSeconds: Object.prototype.hasOwnProperty.call(partialSettings, 'idleThresholdSeconds')
      ? clamp(Math.round(Number(partialSettings.idleThresholdSeconds) || 300), 60, 12 * 60 * 60)
      : clamp(Math.round(Number(previousSettings.idleThresholdSeconds) || 300), 60, 12 * 60 * 60),
    pauseOnLockScreen: Object.prototype.hasOwnProperty.call(partialSettings, 'pauseOnLockScreen')
      ? Boolean(partialSettings.pauseOnLockScreen)
      : previousSettings.pauseOnLockScreen !== false
  };

  state.updatingTrackingProtection = true;
  state.settings = {
    ...previousSettings,
    ...nextSettings
  };
  renderSettingsScreen();

  try {
    state.settings = await window.usageApi.setTrackingProtectionSettings(nextSettings);
  } catch (error) {
    state.settings = previousSettings;
    renderSettingsScreen();
    throw error;
  } finally {
    state.updatingTrackingProtection = false;
  }

  renderSettingsScreen();
}

async function updateManualPause(isPaused) {
  if (state.updatingManualPause) {
    return;
  }

  state.updatingManualPause = true;
  renderSettingsScreen();

  try {
    const snapshot = await window.usageApi.setManualPause(Boolean(isPaused));
    if (snapshot) {
      state.snapshot = snapshot;
      ensureSelectedDayKey();
    }
  } finally {
    state.updatingManualPause = false;
  }

  renderCurrentScreen();
}

function commitIdleThreshold() {
  const minutes = clamp(Math.round(Number(elements.idleThresholdValue.value) || 5), 1, 12 * 60);
  elements.idleThresholdValue.value = String(minutes);
  updateTrackingProtectionSettings({
    idleThresholdSeconds: minutes * 60
  }).catch(() => {});
}

async function updateAutoBackupSettings(partialSettings = {}) {
  if (state.updatingAutoBackup) {
    return;
  }

  const previousSettings = state.settings || {
    autoLaunchEnabled: false,
    hiddenItemKeys: [],
    closeWindowAction: 'tray',
    themePreference: THEME_PREFERENCE_SYSTEM,
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

  const previousSettings = state.settings || {
    autoLaunchEnabled: false,
    hiddenItemKeys: [],
    closeWindowAction: 'tray',
    themePreference: THEME_PREFERENCE_SYSTEM
  };
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

async function updateThemePreference(themePreference) {
  if (state.updatingThemePreference) {
    return;
  }

  const normalizedThemePreference = normalizeThemePreference(themePreference);
  const previousSettings = state.settings || {
    autoLaunchEnabled: false,
    hiddenItemKeys: [],
    closeWindowAction: 'tray',
    themePreference: THEME_PREFERENCE_SYSTEM
  };
  state.updatingThemePreference = true;
  state.settings = {
    ...previousSettings,
    themePreference: normalizedThemePreference
  };
  applyThemePreference();
  renderSettingsScreen();

  try {
    state.settings = await window.usageApi.setThemePreference(normalizedThemePreference);
    applyThemePreference();
  } catch (error) {
    state.settings = previousSettings;
    applyThemePreference();
    renderSettingsScreen();
    throw error;
  } finally {
    state.updatingThemePreference = false;
  }

  renderSettingsScreen();
}

async function updateCustomServiceRules(customServiceRules) {
  if (state.updatingServiceRules) {
    return;
  }

  state.updatingServiceRules = true;
  renderSettingsScreen();

  try {
    state.settings = await window.usageApi.setCustomServiceRules(cloneRuleList(customServiceRules));
    syncRuleDraftsFromSettings();
  } finally {
    state.updatingServiceRules = false;
  }

  renderSettingsScreen();
}

async function updateCategoryRules(categoryRules) {
  if (state.updatingCategoryRules) {
    return;
  }

  state.updatingCategoryRules = true;
  renderSettingsScreen();

  try {
    state.settings = await window.usageApi.setCategoryRules(cloneRuleList(categoryRules));
    syncRuleDraftsFromSettings();
  } finally {
    state.updatingCategoryRules = false;
  }

  renderSettingsScreen();
}

async function openDetail(itemKey) {
  if (!isItemVisible(itemKey)) {
    returnToOverview();
    return;
  }

  if (state.activeScreen === 'timeline') {
    state.detailReturnScreen = 'timeline';
  } else if (state.activeScreen !== 'detail') {
    state.detailReturnScreen = 'overview';
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
  if (state.detailReturnScreen === 'timeline') {
    renderTimelineScreen();
    return;
  }

  renderOverview();
}

function renderCurrentScreen() {
  if (state.activeScreen === 'settings') {
    renderSettingsScreen();
    return;
  }

  if (state.activeScreen === 'timeline') {
    renderTimelineScreen();
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
  const previousSettings = state.settings || {
    autoLaunchEnabled: false,
    hiddenItemKeys: [],
    themePreference: THEME_PREFERENCE_SYSTEM
  };
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

function shiftSelectedDay(offset) {
  if (!state.snapshot || !offset) {
    return;
  }

  const days = state.snapshot.daily.availableDays || [];
  const currentIndex = days.indexOf(state.selectedDayKey);
  const nextIndex = currentIndex + offset;
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= days.length) {
    return;
  }

  state.selectedDayKey = days[nextIndex];

  if (state.activeScreen === 'timeline') {
    renderTimelineScreen();
    return;
  }

  renderOverview();
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

      if (tab.id === 'timeline-button') {
        renderTimelineScreen();
        return;
      }

      state.selectedRange = tab.dataset.range;
      renderOverview();
    });
  });

  elements.settingsSectionTabs.forEach((button) => {
    button.addEventListener('click', () => {
      const nextSection = normalizeSettingsSection(button.dataset.settingsSection);
      if (state.selectedSettingsSection === nextSection && state.activeScreen === 'settings') {
        return;
      }

      state.selectedSettingsSection = nextSection;
      updateSettingsSubnav();
      if (state.activeScreen === 'settings' && typeof elements.settingsScreen?.scrollTo === 'function') {
        elements.settingsScreen.scrollTo({ top: 0, behavior: 'auto' });
      }
    });
  });

  elements.previousDay.addEventListener('click', () => {
    if (!state.snapshot || state.selectedRange !== 'daily') {
      return;
    }

    shiftSelectedDay(-1);
  });

  elements.nextDay.addEventListener('click', () => {
    if (!state.snapshot || state.selectedRange !== 'daily') {
      return;
    }

    shiftSelectedDay(1);
  });

  elements.timelinePreviousDay.addEventListener('click', () => {
    shiftSelectedDay(-1);
  });

  elements.timelineNextDay.addEventListener('click', () => {
    shiftSelectedDay(1);
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

  elements.manualPauseToggle.addEventListener('click', () => {
    const trackingState = getTrackingState();
    updateManualPause(!trackingState.manualPaused).catch(() => {});
  });

  elements.idleDetectionToggle.addEventListener('click', () => {
    updateTrackingProtectionSettings({
      idleDetectionEnabled: !(state.settings?.idleDetectionEnabled !== false)
    }).catch(() => {});
  });

  elements.idleThresholdValue.addEventListener('change', commitIdleThreshold);
  elements.idleThresholdValue.addEventListener('blur', commitIdleThreshold);

  elements.lockScreenPauseToggle.addEventListener('click', () => {
    updateTrackingProtectionSettings({
      pauseOnLockScreen: !(state.settings?.pauseOnLockScreen !== false)
    }).catch(() => {});
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

  elements.themePreferenceButtons.forEach((button) => {
    button.addEventListener('click', () => {
      updateThemePreference(button.dataset.themePreference).catch(() => {});
    });
  });

  elements.exportBackupButton.addEventListener('click', () => {
    handleBackupExport().catch(() => {});
  });

  elements.importBackupButton.addEventListener('click', () => {
    handleBackupImport().catch(() => {});
  });

  elements.addServiceRuleButton.addEventListener('click', () => {
    state.serviceRuleDrafts.push(createBlankServiceRule());
    renderSettingsScreen();
  });

  elements.saveServiceRulesButton.addEventListener('click', () => {
    updateCustomServiceRules(state.serviceRuleDrafts).catch(() => {});
  });

  elements.addCategoryRuleButton.addEventListener('click', () => {
    state.categoryRuleDrafts.push(createBlankCategoryRule());
    renderSettingsScreen();
  });

  elements.saveCategoryRulesButton.addEventListener('click', () => {
    updateCategoryRules(state.categoryRuleDrafts).catch(() => {});
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

  if (systemThemeMediaQuery) {
    const handleSystemThemeChange = () => {
      if (normalizeThemePreference(state.settings?.themePreference) !== THEME_PREFERENCE_SYSTEM) {
        return;
      }

      applyThemePreference();
      renderCurrentScreen();
    };

    if (typeof systemThemeMediaQuery.addEventListener === 'function') {
      systemThemeMediaQuery.addEventListener('change', handleSystemThemeChange);
    } else if (typeof systemThemeMediaQuery.addListener === 'function') {
      systemThemeMediaQuery.addListener(handleSystemThemeChange);
    }
  }

  if (elements.overviewChartCard && typeof ResizeObserver === 'function') {
    const chartCardResizeObserver = new ResizeObserver(() => {
      queueOverviewRankingCardHeightSync();
    });
    chartCardResizeObserver.observe(elements.overviewChartCard);
  }

  window.addEventListener('resize', queueOverviewRankingCardHeightSync);

  if (overviewDesktopMediaQuery) {
    if (typeof overviewDesktopMediaQuery.addEventListener === 'function') {
      overviewDesktopMediaQuery.addEventListener('change', queueOverviewRankingCardHeightSync);
    } else if (typeof overviewDesktopMediaQuery.addListener === 'function') {
      overviewDesktopMediaQuery.addListener(queueOverviewRankingCardHeightSync);
    }
  }
}

async function bootstrap() {
  bindEvents();
  [state.snapshot, state.settings] = await Promise.all([
    window.usageApi.getSnapshot(),
    window.usageApi.getSettings()
  ]);

  syncRuleDraftsFromSettings();
  applyThemePreference();
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

    if (state.activeScreen === 'timeline') {
      loadTimelineDay(state.selectedDayKey, { force: true }).catch(() => {});
      return;
    }

    renderOverview();
  });

  window.usageApi.onSettingsChanged((settings) => {
    state.settings = settings;
    syncRuleDraftsFromSettings();
    applyThemePreference();
    if (state.detailItemKey && !isItemVisible(state.detailItemKey)) {
      returnToOverview();
      return;
    }

    renderCurrentScreen();
  });
}

applyThemePreference();
bootstrap();
