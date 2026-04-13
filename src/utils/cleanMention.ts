export function cleanMention(content: string, botUserId: string): string {
  const mentionPatterns = [
    new RegExp(`<@${botUserId}>`, "g"),
    new RegExp(`<@!${botUserId}>`, "g"),
  ];

  let cleaned = content;
  for (const pattern of mentionPatterns) {
    cleaned = cleaned.replace(pattern, "");
  }

  return cleaned.trim();
}
