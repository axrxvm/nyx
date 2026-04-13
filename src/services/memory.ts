export type MemoryRole = "user" | "assistant";

export interface MemoryEntry {
  role: MemoryRole;
  content: string;
}

const MAX_MEMORY_ENTRIES = 20;
const MAX_MEMORY_USERS = 5_000;
const MEMORY_IDLE_TTL_MS = 6 * 60 * 60 * 1_000;
const MEMORY_CLEANUP_MS = 10 * 60 * 1_000;

interface UserMemoryState {
  entries: MemoryEntry[];
  updatedAt: number;
}

export interface UserMemoryStats {
  entryCount: number;
  updatedAt: number | null;
}

const userMemory = new Map<string, UserMemoryState>();

let lastCleanupAt = 0;

function cleanupMemory(now: number): void {
  if (now - lastCleanupAt < MEMORY_CLEANUP_MS) {
    return;
  }

  lastCleanupAt = now;

  for (const [userId, state] of userMemory) {
    if (now - state.updatedAt > MEMORY_IDLE_TTL_MS) {
      userMemory.delete(userId);
    }
  }

  if (userMemory.size <= MAX_MEMORY_USERS) {
    return;
  }

  const sortedByAge = [...userMemory.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);

  const excess = userMemory.size - MAX_MEMORY_USERS;
  for (let index = 0; index < excess; index += 1) {
    const candidate = sortedByAge[index];
    if (!candidate) {
      break;
    }

    userMemory.delete(candidate[0]);
  }
}

function append(userId: string, entry: MemoryEntry): void {
  const now = Date.now();
  cleanupMemory(now);

  const history = userMemory.get(userId)?.entries ?? [];
  history.push(entry);

  if (history.length > MAX_MEMORY_ENTRIES) {
    history.splice(0, history.length - MAX_MEMORY_ENTRIES);
  }

  userMemory.set(userId, {
    entries: history,
    updatedAt: now,
  });
}

export function addUserPrompt(userId: string, prompt: string): void {
  append(userId, { role: "user", content: prompt });
}

export function addAssistantReply(userId: string, reply: string): void {
  append(userId, { role: "assistant", content: reply });
}

export function getUserMemory(userId: string): MemoryEntry[] {
  const state = userMemory.get(userId);
  if (!state) {
    return [];
  }

  state.updatedAt = Date.now();
  return state.entries;
}

export function clearUserMemory(userId: string): boolean {
  return userMemory.delete(userId);
}

export function getUserMemoryStats(userId: string): UserMemoryStats {
  const state = userMemory.get(userId);
  if (!state) {
    return {
      entryCount: 0,
      updatedAt: null,
    };
  }

  return {
    entryCount: state.entries.length,
    updatedAt: state.updatedAt,
  };
}
