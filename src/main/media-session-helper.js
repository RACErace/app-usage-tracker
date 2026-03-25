const { PlaybackSessionFusionService, __testables } = require('./tracker');

const HELPER_POLL_INTERVAL_MS = 5000;

let playbackSessionFusionService = null;
let pollTimer = null;
let pendingPoll = null;
let latestSnapshot = [];
let latestUpdatedAt = 0;
let isShuttingDown = false;

function sendMessage(message) {
  if (typeof process.send === 'function') {
    process.send(message);
  }
}

function cloneSnapshot(items) {
  return __testables.clonePlaybackCandidateList(items);
}

async function pollOnce() {
  if (pendingPoll) {
    return pendingPoll;
  }

  pendingPoll = playbackSessionFusionService.poll()
    .then((snapshot) => {
      latestSnapshot = cloneSnapshot(snapshot);
      latestUpdatedAt = Date.now();
      sendMessage({
        type: 'snapshot',
        snapshot: latestSnapshot,
        updatedAt: latestUpdatedAt
      });
      return latestSnapshot;
    })
    .catch((error) => {
      sendMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error || 'Unknown helper error')
      });
      return latestSnapshot;
    })
    .finally(() => {
      pendingPoll = null;
    });

  return pendingPoll;
}

function startPolling() {
  if (pollTimer || isShuttingDown) {
    return;
  }

  pollOnce().catch(() => {});
  pollTimer = setInterval(() => {
    pollOnce().catch(() => {});
  }, HELPER_POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function shutdown() {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  stopPolling();
  try {
    await pendingPoll;
  } catch {
    // ignore in shutdown
  }
  process.exit(0);
}

process.on('message', (message) => {
  if (!message || typeof message !== 'object') {
    return;
  }

  if (message.type === 'shutdown') {
    shutdown().catch(() => {
      process.exit(1);
    });
    return;
  }

  if (message.type === 'refresh') {
    pollOnce().catch(() => {});
  }
});

process.on('disconnect', () => {
  shutdown().catch(() => {
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  shutdown().catch(() => {
    process.exit(1);
  });
});

process.on('SIGINT', () => {
  shutdown().catch(() => {
    process.exit(1);
  });
});

function bootstrap() {
  playbackSessionFusionService = new PlaybackSessionFusionService();
  startPolling();
}

bootstrap();
