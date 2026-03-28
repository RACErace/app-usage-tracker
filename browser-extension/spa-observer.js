const CHECK_INTERVAL_MS = 700;

let lastSnapshotKey = '';
let titleObserver = null;

function isTrackableUrl(value) {
  return typeof value === 'string' && /^https?:/i.test(value);
}

function buildSnapshot() {
  const url = window.location.href || '';
  return {
    url,
    pageTitle: document.title || url
  };
}

function getSnapshotKey(snapshot) {
  return JSON.stringify([snapshot.url, snapshot.pageTitle]);
}

function sendSnapshot(reason) {
  const snapshot = buildSnapshot();
  if (!isTrackableUrl(snapshot.url)) {
    return;
  }

  const snapshotKey = getSnapshotKey(snapshot);
  if (snapshotKey === lastSnapshotKey) {
    return;
  }

  lastSnapshotKey = snapshotKey;

  try {
    chrome.runtime.sendMessage({
      type: 'usage-tracker:page-observed',
      reason,
      ...snapshot,
      sentAt: Date.now()
    }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // Ignore transient extension shutdowns.
  }
}

function checkSnapshot(reason) {
  if (document.visibilityState === 'hidden' && reason !== 'visibilitychange') {
    return;
  }

  sendSnapshot(reason);
}

function ensureTitleObserver() {
  if (titleObserver) {
    return;
  }

  const target = document.head || document.documentElement;
  if (!target) {
    return;
  }

  titleObserver = new MutationObserver(() => {
    checkSnapshot('mutation');
  });

  titleObserver.observe(target, {
    subtree: true,
    childList: true,
    characterData: true
  });
}

window.addEventListener('pageshow', () => {
  checkSnapshot('pageshow');
}, true);

window.addEventListener('popstate', () => {
  setTimeout(() => checkSnapshot('popstate'), 0);
}, true);

window.addEventListener('hashchange', () => {
  setTimeout(() => checkSnapshot('hashchange'), 0);
}, true);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    checkSnapshot('visibilitychange');
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    ensureTitleObserver();
    checkSnapshot('domcontentloaded');
  }, { once: true });
} else {
  ensureTitleObserver();
  checkSnapshot('ready');
}

setInterval(() => {
  ensureTitleObserver();
  checkSnapshot('interval');
}, CHECK_INTERVAL_MS);
