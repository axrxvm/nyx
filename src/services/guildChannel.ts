import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface GuildChannelRecord {
  channelId: string;
  updatedAt: number;
}

interface StoredGuildChannelsShape {
  channels?: Record<string, GuildChannelRecord>;
}

const DATA_DIR_PATH = join(process.cwd(), "data");
const STORE_PATH = join(DATA_DIR_PATH, "guild-channels.json");
const MAX_GUILDS = 25_000;

const guildChannels = new Map<string, GuildChannelRecord>();

let loadPromise: Promise<void> | null = null;
let persistPromise: Promise<void> = Promise.resolve();
let persistScheduled = false;

function normalizeGuildId(guildId: string): string {
  return guildId.trim();
}

async function ensureLoaded(): Promise<void> {
  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    try {
      const raw = await readFile(STORE_PATH, "utf8");
      const parsed = JSON.parse(raw) as StoredGuildChannelsShape;
      const records = parsed?.channels ?? {};

      for (const [guildId, record] of Object.entries(records)) {
        if (!guildId || typeof record !== "object" || !record?.channelId) {
          continue;
        }

        guildChannels.set(normalizeGuildId(guildId), {
          channelId: String(record.channelId).trim(),
          updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : Date.now(),
        });
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "ENOENT") {
        console.warn("Failed to load guild channel settings:", error);
      }
    }
  })();

  return loadPromise;
}

function enforceCapacity(): void {
  if (guildChannels.size <= MAX_GUILDS) {
    return;
  }

  const sorted = [...guildChannels.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
  const excess = guildChannels.size - MAX_GUILDS;

  for (let index = 0; index < excess; index += 1) {
    const item = sorted[index];
    if (!item) {
      break;
    }

    guildChannels.delete(item[0]);
  }
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
        await mkdir(DATA_DIR_PATH, { recursive: true });

        const payload: StoredGuildChannelsShape = {
          channels: Object.fromEntries(guildChannels.entries()),
        };

        await writeFile(STORE_PATH, JSON.stringify(payload, null, 2), "utf8");
      })
      .catch((error) => {
        console.error("Failed to persist guild channel settings:", error);
      });
  }, 250);
}

export async function getGuildChatChannelId(guildId: string): Promise<string | null> {
  await ensureLoaded();
  const key = normalizeGuildId(guildId);
  return guildChannels.get(key)?.channelId ?? null;
}

export async function setGuildChatChannel(guildId: string, channelId: string): Promise<void> {
  await ensureLoaded();

  const key = normalizeGuildId(guildId);
  guildChannels.set(key, {
    channelId: channelId.trim(),
    updatedAt: Date.now(),
  });

  enforceCapacity();
  schedulePersist();
}

export async function clearGuildChatChannel(guildId: string): Promise<boolean> {
  await ensureLoaded();

  const deleted = guildChannels.delete(normalizeGuildId(guildId));
  if (deleted) {
    schedulePersist();
  }

  return deleted;
}
