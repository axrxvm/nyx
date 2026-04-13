const RATE_LIMIT_MAX_REQUESTS = 5;
const RATE_LIMIT_WINDOW_MS = 20_000;
const RATE_LIMIT_CLEANUP_MS = 120_000;

interface UserRateState {
  timestamps: number[];
}

const requestLog = new Map<string, UserRateState>();
let lastCleanupAt = 0;

function cleanupStaleEntries(now: number): void {
  if (now - lastCleanupAt < RATE_LIMIT_CLEANUP_MS) {
    return;
  }

  lastCleanupAt = now;
  for (const [userId, state] of requestLog) {
    const { timestamps } = state;
    while (timestamps.length > 0 && now - timestamps[0] >= RATE_LIMIT_WINDOW_MS) {
      timestamps.shift();
    }

    if (timestamps.length === 0) {
      requestLog.delete(userId);
    }
  }
}

export function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  cleanupStaleEntries(now);

  const state = requestLog.get(userId) ?? { timestamps: [] };
  while (state.timestamps.length > 0 && now - state.timestamps[0] >= RATE_LIMIT_WINDOW_MS) {
    state.timestamps.shift();
  }

  if (state.timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    requestLog.set(userId, state);
    return false;
  }

  state.timestamps.push(now);
  requestLog.set(userId, state);
  return true;
}
