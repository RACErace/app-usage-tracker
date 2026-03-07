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
  updatingHiddenItems: false
};

const elements = {
  topbar: document.querySelector('.topbar'),
  screenTitle: document.getElementById('screen-title'),
  overviewScreen: document.getElementById('overview-screen'),
  detailScreen: document.getElementById('detail-screen'),
  settingsScreen: document.getElementById('settings-screen'),
  settingsButton: document.getElementById('settings-button'),
  rangeTabs: [...document.querySelectorAll('.range-tab')],
  previousDay: document.getElementById('previous-day'),
  nextDay: document.getElementById('next-day'),
  dateLabel: document.getElementById('date-label'),
  chartSectionTitle: document.getElementById('chart-section-title'),
  summaryDuration: document.getElementById('summary-duration'),
  summarySubtitle: document.getElementById('summary-subtitle'),
  chartCanvas: document.getElementById('usage-chart'),
  chartTooltip: document.getElementById('chart-tooltip'),
  rankingList: document.getElementById('ranking-list'),
  settingsBridgeUrlText: document.getElementById('settings-bridge-url-text'),
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

function formatDayLabel(dayKey) {
  if (!dayKey) {
    return '今天';
  }

  const date = new Date(`${dayKey}T00:00:00`);
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
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

  element.innerHTML = '';
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
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const pointX = (event.clientX - rect.left) * scaleX;
    const pointY = (event.clientY - rect.top) * scaleY;
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

function showTooltip(tooltip, rect, chartPoint, content) {
  tooltip.innerHTML = content;
  tooltip.classList.remove('hidden');
  const relativeX = (chartPoint.x + chartPoint.width / 2) / rect.width;
  const relativeY = chartPoint.y / rect.height;
  tooltip.style.left = `${relativeX * 100}%`;
  tooltip.style.top = `${Math.max(relativeY * 100 - 4, 15)}%`;
}

function updateHeader() {
  const isOverview = state.activeScreen === 'overview';
  const isDetail = state.activeScreen === 'detail';

  elements.topbar.classList.toggle('overview-hidden', isOverview);
  elements.backButton.classList.toggle('inactive', isOverview);
  elements.settingsButton.classList.toggle('hidden-action', !isOverview);
  elements.screenTitle.textContent = isDetail
    ? (state.detail?.label || '详情')
    : state.activeScreen === 'settings'
      ? '设置'
      : '';
}

function showScreen(screen) {
  state.activeScreen = screen;
  elements.overviewScreen.classList.toggle('active', screen === 'overview');
  elements.detailScreen.classList.toggle('active', screen === 'detail');
  elements.settingsScreen.classList.toggle('active', screen === 'settings');
  updateHeader();
}

function renderSettingsState() {
  const enabled = Boolean(state.settings?.autoLaunchEnabled);
  elements.autoLaunchSwitch.classList.toggle('active', enabled);
  elements.autoLaunchDot.classList.toggle('active', enabled);
  elements.autoLaunchStatus.textContent = enabled ? '已开启开机自启动' : '未开启开机自启动';
  elements.autoLaunchToggle.setAttribute('aria-checked', enabled ? 'true' : 'false');
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
  elements.itemVisibilityList.innerHTML = '';

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
  elements.rankingList.innerHTML = '';
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

  elements.rangeTabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.range === state.selectedRange);
  });

  elements.previousDay.style.visibility = isDaily ? 'visible' : 'hidden';
  elements.nextDay.style.visibility = isDaily ? 'visible' : 'hidden';
  elements.dateLabel.textContent = isDaily ? formatDayLabel(state.selectedDayKey) : formatWeekRange(weekly.dayKeys);
  elements.chartSectionTitle.textContent = isDaily ? '使用时长（截至今天）' : '使用时长（近 7 天）';
  elements.summaryDuration.textContent = isDaily ? formatDuration(activeDay.totalMs) : formatDuration(weekly.averageMs, 'short');
  elements.summarySubtitle.textContent = isDaily ? '' : `总时长：${formatDuration(weekly.totalMs)}`;
  elements.settingsBridgeUrlText.textContent = snapshot.meta.bridgeUrl;

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
          elements.chartTooltip,
          rect,
          hit,
          `
            <span class="tooltip-value">${formatDuration(hit.value * 60000)}</span>
            <span class="tooltip-label">${hit.index} 时 - ${hit.index + 1} 时</span>
            <div class="tooltip-list">
              ${topItems
                .map(
                  (item) => `
                    <div class="tooltip-row">
                      <span class="tooltip-chip" style="background:${item.color}">${item.initials}</span>
                      <span>${item.label} ${item.minutes}分钟</span>
                    </div>`
                )
                .join('')}
            </div>`
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
          elements.chartTooltip,
          rect,
          hit,
          `
            <span class="tooltip-value">${formatDuration(weekly.dailyTotals[hit.index].totalMs)}</span>
            <span class="tooltip-label">${formatDayLabel(dayKey)}</span>
            <div class="tooltip-list">
              ${topItems
                .map(
                  (item) => `
                    <div class="tooltip-row">
                      <span class="tooltip-chip" style="background:${item.color}">${item.initials}</span>
                      <span>${item.label} ${formatDuration(item.duration, 'short')}</span>
                    </div>`
                )
                .join('')}
            </div>`
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

  elements.detailMeta.innerHTML = '';
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
      row.innerHTML = `<div class="metadata-label">${label}</div><div class="metadata-value">${value}</div>`;
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
        elements.detailDayTooltip,
        rect,
        hit,
        `<span class="tooltip-value">${formatDuration(hit.value * 60000)}</span><span class="tooltip-label">${hit.index} 时 - ${hit.index + 1} 时</span>`
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
        elements.detailWeekTooltip,
        rect,
        hit,
        `<span class="tooltip-value">${formatDuration(day.totalMs)}</span><span class="tooltip-label">${formatDayLabel(day.dayKey)}</span>`
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

async function openDetail(itemKey) {
  if (!isItemVisible(itemKey)) {
    returnToOverview();
    return;
  }

  state.detailItemKey = itemKey;
  const detail = await window.usageApi.getDetail(itemKey);
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
  elements.rangeTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
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

  elements.settingsButton.addEventListener('click', () => {
    renderSettingsScreen();
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