import { AttachmentBuilder } from "discord.js";
import { clampDiscordMessage, normalizeDiscordMessage } from "./discordLimit";

const DISCORD_MESSAGE_MAX = 2000;
const PREVIEW_HEAD = "Response was too long for a Discord message. Full output is attached.";
const FENCED_CODE_LANGUAGE_PATTERN = /```\s*([a-zA-Z0-9_+-]+)/;

const LANGUAGE_EXTENSION_MAP: Record<string, string> = {
  ts: "ts",
  typescript: "ts",
  js: "js",
  javascript: "js",
  jsx: "jsx",
  tsx: "tsx",
  py: "py",
  python: "py",
  java: "java",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  cs: "cs",
  csharp: "cs",
  go: "go",
  rust: "rs",
  rs: "rs",
  ruby: "rb",
  rb: "rb",
  php: "php",
  swift: "swift",
  kotlin: "kt",
  kt: "kt",
  scala: "scala",
  sh: "sh",
  bash: "sh",
  zsh: "sh",
  powershell: "ps1",
  ps1: "ps1",
  sql: "sql",
  html: "html",
  css: "css",
  scss: "scss",
  json: "json",
  yaml: "yml",
  yml: "yml",
  toml: "toml",
  xml: "xml",
  md: "md",
  markdown: "md",
  txt: "txt",
  text: "txt",
};

function inferAttachmentExtension(content: string): string {
  const match = content.match(FENCED_CODE_LANGUAGE_PATTERN);
  const language = match?.[1]?.trim().toLowerCase();
  if (!language) {
    return "md";
  }

  return LANGUAGE_EXTENSION_MAP[language] ?? "txt";
}

export interface LongResponsePayload {
  content: string;
  files?: AttachmentBuilder[];
}

interface LongResponseOptions {
  includePreview?: boolean;
}

export function buildLongResponsePayload(
  responseText: string,
  fileBaseName = "nyx-response",
  options: LongResponseOptions = {},
): LongResponsePayload {
  const normalized = normalizeDiscordMessage(responseText);
  if (normalized.length <= DISCORD_MESSAGE_MAX) {
    return {
      content: normalized,
    };
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const extension = inferAttachmentExtension(normalized);
  const filename = `${fileBaseName}-${timestamp}.${extension}`;
  const attachment = new AttachmentBuilder(Buffer.from(normalized, "utf8"), {
    name: filename,
  });

  const attachmentNotice = [
    PREVIEW_HEAD,
    "",
    `Full output is attached as ${filename}.`,
    "",
    "Preview:",
  ].join("\n");

  const includePreview = options.includePreview ?? true;
  if (!includePreview) {
    return {
      content: `Full output is attached as ${filename}.`,
      files: [attachment],
    };
  }

  const remaining = DISCORD_MESSAGE_MAX - attachmentNotice.length - 1;
  const previewBody = remaining > 0
    ? normalized.slice(0, remaining)
    : "";
  const content = clampDiscordMessage(
    previewBody
      ? `${attachmentNotice}\n${previewBody}`
      : `Full output is attached as ${filename}.`,
  );

  return {
    content,
    files: [attachment],
  };
}
