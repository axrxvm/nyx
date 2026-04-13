import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface CompanionProfile {
  displayName?: string;
  tone?: string;
  goals?: string;
  memoryEnabled?: boolean;
  updatedAt: number;
}

interface StoredProfileShape {
  profiles?: Record<string, CompanionProfile>;
}

const PROFILE_FILE_PATH = join(process.cwd(), "data", "companion-profiles.json");
const PROFILE_DIR_PATH = join(process.cwd(), "data");
const MAX_PROFILE_USERS = 20_000;

const userProfiles = new Map<string, CompanionProfile>();

let loadPromise: Promise<void> | null = null;
let persistPromise: Promise<void> = Promise.resolve();
let persistScheduled = false;

function trimValue(input: string | null | undefined, maxLength: number): string | undefined {
  if (!input) {
    return undefined;
  }

  const value = input.trim();
  if (!value) {
    return undefined;
  }

  if (value.length <= maxLength) {
    return value;
  }

  return value.slice(0, maxLength);
}

function normalizeProfile(profile: Partial<CompanionProfile>, previous?: CompanionProfile): CompanionProfile {
  return {
    displayName: trimValue(profile.displayName ?? previous?.displayName, 60),
    tone: trimValue(profile.tone ?? previous?.tone, 160),
    goals: trimValue(profile.goals ?? previous?.goals, 500),
    memoryEnabled:
      typeof profile.memoryEnabled === "boolean"
        ? profile.memoryEnabled
        : (previous?.memoryEnabled ?? true),
    updatedAt: Date.now(),
  };
}

async function ensureLoaded(): Promise<void> {
  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    try {
      const raw = await readFile(PROFILE_FILE_PATH, "utf8");
      const parsed = JSON.parse(raw) as StoredProfileShape;
      const records = parsed?.profiles ?? {};

      for (const [userId, profile] of Object.entries(records)) {
        if (!userId || typeof profile !== "object" || !profile) {
          continue;
        }

        userProfiles.set(userId, normalizeProfile(profile));
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "ENOENT") {
        console.warn("Failed to load companion profiles:", error);
      }
    }
  })();

  return loadPromise;
}

function schedulePersist(): void {
  if (persistScheduled) {
    return;
  }

  persistScheduled = true;
  setTimeout(() => {
    persistScheduled = false;

    persistPromise = persistPromise
      .then(async () => {
        await mkdir(PROFILE_DIR_PATH, { recursive: true });

        const payload: StoredProfileShape = {
          profiles: Object.fromEntries(userProfiles.entries()),
        };

        await writeFile(PROFILE_FILE_PATH, JSON.stringify(payload, null, 2), "utf8");
      })
      .catch((error) => {
        console.error("Failed to persist companion profiles:", error);
      });
  }, 250);
}

function enforceProfileCapacity(): void {
  if (userProfiles.size <= MAX_PROFILE_USERS) {
    return;
  }

  const sorted = [...userProfiles.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
  const excess = userProfiles.size - MAX_PROFILE_USERS;

  for (let index = 0; index < excess; index += 1) {
    const item = sorted[index];
    if (!item) {
      break;
    }

    userProfiles.delete(item[0]);
  }
}

export async function getUserProfile(userId: string): Promise<CompanionProfile | null> {
  await ensureLoaded();
  return userProfiles.get(userId) ?? null;
}

export async function upsertUserProfile(
  userId: string,
  changes: Partial<Pick<CompanionProfile, "displayName" | "tone" | "goals" | "memoryEnabled">>,
): Promise<CompanionProfile> {
  await ensureLoaded();

  const previous = userProfiles.get(userId);
  const next = normalizeProfile(changes, previous);

  userProfiles.set(userId, next);
  enforceProfileCapacity();
  schedulePersist();

  return next;
}

export async function clearUserProfile(userId: string): Promise<boolean> {
  await ensureLoaded();
  const deleted = userProfiles.delete(userId);

  if (deleted) {
    schedulePersist();
  }

  return deleted;
}

export function buildCompanionProfileInstruction(profile: CompanionProfile | null): string | null {
  if (!profile) {
    return null;
  }

  const lines: string[] = [];
  if (profile.displayName) {
    lines.push(`User preferred name: ${profile.displayName}`);
  }

  if (profile.tone) {
    lines.push(`Preferred response tone: ${profile.tone}`);
  }

  if (profile.goals) {
    lines.push(`User goals and priorities: ${profile.goals}`);
  }

  if (lines.length === 0) {
    return null;
  }

  return [
    "Personalization profile for this user:",
    ...lines,
    "Use this profile as guidance while staying truthful and concise.",
  ].join("\n");
}

export async function isUserMemoryEnabled(userId: string): Promise<boolean> {
  await ensureLoaded();
  const profile = userProfiles.get(userId);
  return profile?.memoryEnabled ?? true;
}
