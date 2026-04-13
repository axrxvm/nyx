const DISCORD_MESSAGE_MAX = 2000;
const TRUNCATION_SUFFIX = "\n\n…[truncated]";

const BARE_URL_PATTERN = /(?<!<)(https?:\/\/[^\s<]+)(?!>)/gi;

export function suppressDefaultEmbeds(content: string): string {
  return content.replace(BARE_URL_PATTERN, "<$1>");
}

export function normalizeDiscordMessage(content: string): string {
  return suppressDefaultEmbeds(content?.trim() || "No response generated.");
}

export function clampDiscordMessage(content: string): string {
  const text = normalizeDiscordMessage(content);
  if (text.length <= DISCORD_MESSAGE_MAX) {
    return text;
  }

  const maxContentLength = DISCORD_MESSAGE_MAX - TRUNCATION_SUFFIX.length;
  if (maxContentLength <= 0) {
    return text.slice(0, DISCORD_MESSAGE_MAX);
  }

  return `${text.slice(0, maxContentLength)}${TRUNCATION_SUFFIX}`;
}
