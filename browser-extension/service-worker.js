const BRIDGE_URL = 'http://127.0.0.1:32123/v1/browser-event';
const BRIDGE_SHARED_HEADER_NAME = 'X-App-Usage-Tracker-Bridge';
const BRIDGE_SHARED_HEADER_VALUE = 'usage-tracker-extension';

async function getBrowserFamily() {
  const agent = navigator.userAgent || '';
  if (agent.includes('Edg/')) {
    return 'Edge';
  }

  if (agent.includes('OPR/')) {
    return 'Opera';
  }

  if (navigator.brave && typeof navigator.brave.isBrave === 'function') {
    try {
      if (await navigator.brave.isBrave()) {
        return 'Brave';
      }
    } catch {
      // ignore
    }
  }

  return 'Chrome';
}

async function postActiveTab(tabId) {
  if (!tabId) {
    return;
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.url || !/^https?:/i.test(tab.url)) {
      return;
    }

    await fetch(BRIDGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [BRIDGE_SHARED_HEADER_NAME]: BRIDGE_SHARED_HEADER_VALUE
      },
      body: JSON.stringify({
        browserFamily: await getBrowserFamily(),
        pageTitle: tab.title || tab.url,
        url: tab.url,
        sentAt: Date.now()
      })
    });
  } catch {
    // 桌面端未运行时静默忽略。
  }
}

async function sendCurrentActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab) {
      await postActiveTab(tab.id);
    }
  } catch {
    // 忽略。
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('usage-tracker-heartbeat', { periodInMinutes: 0.5 });
  sendCurrentActiveTab();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('usage-tracker-heartbeat', { periodInMinutes: 0.5 });
  sendCurrentActiveTab();
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  postActiveTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) {
    postActiveTab(tabId);
  }
});

chrome.windows.onFocusChanged.addListener(() => {
  sendCurrentActiveTab();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'usage-tracker-heartbeat') {
    sendCurrentActiveTab();
  }
});
