const state = {
  snapshot: null,
  settings: null,
  selectedRange: 'daily',
  selectedDayKey: null,
  detailItemKey: null,
  detail: null,
  activeScreen: 'overview',
  iconCache: new Map(),
  unsubscribe: null
};

const elements = {
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
  bridgeUrlText: document.getElementById('bridge-url-text'),
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
  itemTemplate: document.getElementById('ranking-item-template')
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

function drawBarChart({ canvas, bars, labels, yLabels, color, tooltip, onHover }) {
  const context = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const padding = { top: 22, right: 44, bottom: 36, left: 8 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...bars, 1);
  const step = chartWidth / Math.max(bars.length, 1);
  const barWidth = Math.min(14, step * 0.52);
  const hitAreas = [];

  context.clearRect(0, 0, width, height);
  context.font = '12px Segoe UI';

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
    context.fillText(value.label, width - padding.right + 10, y + 4);
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
      context.fillText(label, x + barWidth / 2, height - 8);
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

  elements.backButton.classList.toggle('inactive', isOverview);
  elements.settingsButton.classList.toggle('hidden-action', !isOverview);
  elements.screenTitle.textContent = isDetail
    ? (state.detail?.label || '详情')
    : state.activeScreen === 'settings'
      ? '设置'
      : '使用统计';
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

function renderRanking(items, totalMs) {
  elements.rankingList.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'ranking-subtitle';
    empty.textContent = '当前还没有采集到使用数据。';
    elements.rankingList.appendChild(empty);
    return;
  }

  items.slice(0, 8).forEach((item) => {
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

  hydrateRankingIcons(items.slice(0, 8)).catch(() => {});
}

function renderOverview() {
  const snapshot = state.snapshot;
  if (!snapshot) {
    return;
  }

  ensureSelectedDayKey();
  const activeDay = lookupDay(state.selectedDayKey);
  const isDaily = state.selectedRange === 'daily';
  const rankingItems = isDaily ? activeDay.items : snapshot.weekly.items;
  const totalMs = isDaily ? activeDay.totalMs : snapshot.weekly.totalMs;

  elements.rangeTabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.range === state.selectedRange);
  });

  elements.previousDay.style.visibility = isDaily ? 'visible' : 'hidden';
  elements.nextDay.style.visibility = isDaily ? 'visible' : 'hidden';
  elements.dateLabel.textContent = isDaily ? formatDayLabel(state.selectedDayKey) : formatWeekRange(snapshot.weekly.dayKeys);
  elements.chartSectionTitle.textContent = isDaily ? '使用时长（截至今天）' : '使用时长（近 7 天）';
  elements.summaryDuration.textContent = isDaily ? formatDuration(activeDay.totalMs) : formatDuration(snapshot.weekly.averageMs, 'short');
  elements.summarySubtitle.textContent = isDaily ? '' : `总时长：${formatDuration(snapshot.weekly.totalMs)}`;
  elements.bridgeUrlText.textContent = snapshot.meta.bridgeUrl;

  renderRanking(rankingItems, totalMs);
  renderSettingsState();

  if (isDaily) {
    const hourly = activeDay.hourly || snapshot.daily.hourly;
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
      bars: snapshot.weekly.dailyTotals.map((item) => Math.round((item.totalMs / 3600000) * 10) / 10),
      labels: snapshot.weekly.dayKeys.map((dayKey) => weekdayLabel(dayKey)),
      yLabels: [
        { ratio: 0, label: '0' },
        { ratio: 0.66, label: '平均' },
        { ratio: 1, label: '12 小时' }
      ],
      color: '#1a8dff',
      tooltip: elements.chartTooltip,
      onHover: (hit, rect) => {
        const dayKey = snapshot.weekly.dayKeys[hit.index];
        const topItems = snapshot.weekly.items
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
            <span class="tooltip-value">${formatDuration(snapshot.weekly.dailyTotals[hit.index].totalMs)}</span>
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
  showScreen('settings');
}

async function openDetail(itemKey) {
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
      renderSettingsState();
    } finally {
      elements.autoLaunchToggle.disabled = false;
    }
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
    renderSettingsState();
  });
}

bootstrap();