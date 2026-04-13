import type { AiInputFile } from "./ai";
import { isLikelyImageUrl } from "../utils/attachmentImages";

export interface AiInputSource {
  url: string;
  filename?: string | null;
  contentType?: string | null;
}

export interface ResolvedAiInputs {
  imageUrls: string[];
  files: AiInputFile[];
  inputTextBlocks: string[];
}

const FILE_FETCH_TIMEOUT_MS = 15_000;
const MAX_TEXT_CHARS = 12_000;

const TEXT_FILE_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "csv",
  "json",
  "jsonl",
  "yaml",
  "yml",
  "xml",
  "html",
  "css",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "py",
  "java",
  "kt",
  "go",
  "rs",
  "rb",
  "php",
  "swift",
  "scala",
  "c",
  "cc",
  "cpp",
  "h",
  "hpp",
  "sh",
  "bash",
  "zsh",
  "sql",
  "toml",
  "ini",
  "env",
  "lock",
  "gitignore",
  "dockerfile",
]);

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeTextBlock(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function inferFilename(url: string, filename?: string | null): string {
  if (filename?.trim()) {
    return filename.trim();
  }

  try {
    const pathname = new URL(url).pathname;
    const lastSegment = pathname.split("/").pop()?.trim();
    if (lastSegment) {
      return decodeURIComponent(lastSegment);
    }
  } catch {
    return "attachment.bin";
  }

  return "attachment.bin";
}

function getExtension(filename: string): string {
  const value = filename.toLowerCase();
  const index = value.lastIndexOf(".");
  if (index < 0 || index === value.length - 1) {
    return "";
  }

  return value.slice(index + 1);
}

function isPdfSource(source: AiInputSource, filename: string): boolean {
  const contentType = source.contentType?.toLowerCase() ?? "";
  if (contentType.includes("application/pdf")) {
    return true;
  }

  if (filename.toLowerCase().endsWith(".pdf")) {
    return true;
  }

  return /\.pdf(?:\?|$)/i.test(source.url);
}

function isTextLikeSource(source: AiInputSource, filename: string): boolean {
  const contentType = source.contentType?.toLowerCase() ?? "";
  if (
    contentType.startsWith("text/") ||
    contentType.includes("json") ||
    contentType.includes("xml") ||
    contentType.includes("javascript") ||
    contentType.includes("typescript") ||
    contentType.includes("yaml") ||
    contentType.includes("csv")
  ) {
    return true;
  }

  const extension = getExtension(filename);
  return extension ? TEXT_FILE_EXTENSIONS.has(extension) : false;
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxChars - 13))}\n\n...[truncated]`;
}

async function fetchTextFile(url: string): Promise<string> {
  const response = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(FILE_FETCH_TIMEOUT_MS),
    headers: {
      "User-Agent": "NyxFileInput/1.0",
      Accept: "text/*, application/json, application/xml, text/plain;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch text file (${response.status}).`);
  }

  const text = await response.text();
  const normalized = text.trim();
  if (!normalized) {
    return "";
  }

  return truncateText(normalized, MAX_TEXT_CHARS);
}

export async function resolveAiInputsFromSources(
  sources: AiInputSource[],
  maxSources = 3,
): Promise<ResolvedAiInputs> {
  const uniqueSources = [...new Map(
    sources
      .map((source) => ({
        ...source,
        url: source.url.trim(),
      }))
      .filter((source) => Boolean(source.url))
      .map((source) => [source.url, source]),
  ).values()].slice(0, Math.max(1, maxSources));

  const imageUrls: string[] = [];
  const files: AiInputFile[] = [];
  const inputTextBlocks: string[] = [];

  for (const source of uniqueSources) {
    const filename = inferFilename(source.url, source.filename);

    if (isLikelyImageUrl(source.url) || source.contentType?.toLowerCase().startsWith("image/")) {
      imageUrls.push(source.url);
      continue;
    }

    if (isPdfSource(source, filename)) {
      files.push({
        filename,
        fileData: source.url,
        mimeType: source.contentType ?? "application/pdf",
      });
      continue;
    }

    if (isTextLikeSource(source, filename)) {
      try {
        const textContent = await fetchTextFile(source.url);
        if (textContent) {
          inputTextBlocks.push(`Attached file (${filename}):\n${textContent}`);
          continue;
        }
      } catch {
        files.push({
          filename,
          fileData: source.url,
          mimeType: source.contentType ?? undefined,
        });
        continue;
      }
    }

    files.push({
      filename,
      fileData: source.url,
      mimeType: source.contentType ?? undefined,
    });
  }

  return {
    imageUrls: [...new Set(imageUrls)],
    files: [...new Map(files.map((file) => [`${file.filename}::${file.fileData}`, file])).values()],
    inputTextBlocks: inputTextBlocks.map((block) => normalizeTextBlock(block)).filter(Boolean),
  };
}
