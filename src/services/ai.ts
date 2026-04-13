import type { TextBasedChannel } from "discord.js";
import { appConfig } from "../config";
import type { MemoryEntry } from "./memory";
import { normalizeDiscordMessage } from "../utils/discordLimit";
import { createGeminiClient, isAlabsQuotaExhausted } from "./gemini";
import { buildCompanionProfileInstruction, getUserProfile } from "./profile";

type ChatRole = "system" | "user" | "assistant";

type ChatContentPart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image_url";
      image_url: {
        url: string;
      };
    }
  | {
      type: "file";
      file: {
        filename: string;
        file_data: string;
      };
    };

type ChatMessageContent = string | ChatContentPart[];

interface ChatMessage {
  role: ChatRole;
  content: ChatMessageContent;
}

interface ChatCompletionPlugin {
  id: "file-parser";
  pdf?: {
    engine: "pdf-text" | "mistral-ocr" | "native";
  };
}

export interface AiInputFile {
  filename: string;
  fileData: string;
  mimeType?: string;
}

export type PdfInputFile = AiInputFile;

interface AlabsChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface AlabsStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
    };
    message?: {
      content?: string;
    };
  }>;
}

export interface ConversationLine {
  author: string;
  content: string;
  messageId?: string;
}

export interface ConversationContextOptions {
  includeBotMessages?: boolean;
  excludeMessageId?: string;
  includeSummaryOfOlderMessages?: boolean;
  maxFetchMessages?: number;
}

export interface PromptContextMeta {
  channelKind?: string;
  responseMode?: string;
  instruction?: string;
}

export interface AskAIOptions {
  systemPrompt?: string;
  channelContext?: ConversationLine[];
  promptContext?: PromptContextMeta;
  userMemory?: MemoryEntry[];
  userId?: string;
  imageUrls?: string[];
  files?: AiInputFile[];
  pdfFiles?: PdfInputFile[];
  pdfEngine?: "pdf-text" | "mistral-ocr" | "native";
  inputTextBlocks?: string[];
  stream?: boolean;
  onProgress?: (partialText: string) => Promise<void>;
  model?: string;
}

/**
 * Error raised when a caller explicitly requests a model that ALabs cannot serve,
 * and automatic fallback would otherwise change model behavior unexpectedly.
 */
export class SelectedAlabsModelUnavailableError extends Error {
  /**
   * Creates a standardized error describing that the user-selected ALabs model is unavailable.
   */
  constructor() {
    super(
      "Selected model is unavailable right now in ALabs AI SDK. Please use /ask normally (without choosing a model).",
    );
    this.name = "SelectedAlabsModelUnavailableError";
  }
}

const MAX_CONTEXT_LINES = 6;
const MAX_CONTEXT_CHARS_PER_LINE = 220;
const MAX_MEMORY_ENTRIES = 8;
const MAX_MEMORY_CHARS_PER_ENTRY = 280;
const CONTEXT_CACHE_TTL_MS = 4_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_SUMMARY_POINTS = 12;
const MAX_SUMMARY_CHARS = 750;

interface ChannelContextCacheEntry {
  expiresAt: number;
  rows: ConversationLine[];
  pending?: Promise<ConversationLine[]>;
}

const channelContextCache = new Map<string, ChannelContextCacheEntry>();

/**
 * Builds a stable cache key for channel conversation context lookups.
 *
 * @param channelId Discord channel identifier used to scope cache entries.
 * @param limit Requested number of context lines, normalized to at least 1.
 * @param options Context options that materially change the fetched result shape.
 * @returns A pipe-delimited cache key that uniquely represents the requested context variant.
 */
function buildContextCacheKey(
  channelId: string,
  limit: number,
  options: Omit<ConversationContextOptions, "excludeMessageId">,
): string {
  return [
    channelId,
    Math.max(limit, 1),
    options.includeBotMessages ? "bot1" : "bot0",
    options.includeSummaryOfOlderMessages ? "sum1" : "sum0",
    options.maxFetchMessages ? String(options.maxFetchMessages) : "mf0",
  ].join("|");
}

/**
 * Normalizes whitespace and truncates text to a safe maximum length.
 *
 * @param value Source text to normalize and potentially shorten.
 * @param maxChars Maximum number of characters allowed in the output string.
 * @returns The normalized text, truncated with an ellipsis when it exceeds the limit.
 */
function shortenText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars - 1)}…`;
}

/**
 * Compacts channel context to fit prompt budget constraints while preserving a summary row,
 * when available, and the most recent conversational lines.
 *
 * @param channelContext Full channel context lines in chronological order.
 * @returns A trimmed and per-field shortened context array suitable for prompt injection.
 */
function compactContext(channelContext: ConversationLine[]): ConversationLine[] {
  const summary = channelContext.find((line) => line.author === "conversation-summary");
  const nonSummary = channelContext.filter((line) => line.author !== "conversation-summary");
  const remainingSlots = summary ? Math.max(MAX_CONTEXT_LINES - 1, 0) : MAX_CONTEXT_LINES;
  const tail = nonSummary.slice(-remainingSlots);
  const selected = summary ? [summary, ...tail] : tail;

  return selected.map((line) => ({
    author: shortenText(line.author, 40),
    content: shortenText(line.content, MAX_CONTEXT_CHARS_PER_LINE),
    ...(line.messageId ? { messageId: line.messageId } : {}),
  }));
}

/**
 * Limits user memory entries to a bounded tail and truncates entry content for prompt safety.
 *
 * @param memory Full memory entries associated with a user.
 * @returns A compacted list of memory entries preserving role and shortened content.
 */
function compactMemory(memory: MemoryEntry[]): MemoryEntry[] {
  return memory.slice(-MAX_MEMORY_ENTRIES).map((entry) => ({
    role: entry.role,
    content: shortenText(entry.content, MAX_MEMORY_CHARS_PER_ENTRY),
  }));
}

/**
 * Produces a lightweight textual summary for older conversation lines that do not fit
 * in the direct context window.
 *
 * @param lines Older conversation lines that are candidates for summarization.
 * @returns A bounded summary string, or an empty string when no source lines exist.
 */
function buildOlderConversationSummary(lines: ConversationLine[]): string {
  if (lines.length === 0) {
    return "";
  }

  const step = Math.max(1, Math.ceil(lines.length / MAX_SUMMARY_POINTS));
  const picked = lines.filter((_, index) => index % step === 0).slice(-MAX_SUMMARY_POINTS);

  const points = picked.map((line) =>
    `${shortenText(line.author, 32)}: ${shortenText(line.content, 90)}`,
  );

  const summary = `Earlier conversation summary:\n${points.join("\n")}`;
  return shortenText(summary, MAX_SUMMARY_CHARS);
}

/**
 * Applies final context shaping for callers by excluding a message when requested,
 * preserving summary placement, and enforcing a minimum-safe limit.
 *
 * @param rows Candidate context rows retrieved from cache or API.
 * @param limit Maximum number of rows to return, normalized to at least 1.
 * @param excludeMessageId Optional message identifier to remove from final context.
 * @returns Ordered context rows ready for prompt construction.
 */
function finalizeContextRows(
  rows: ConversationLine[],
  limit: number,
  excludeMessageId?: string,
): ConversationLine[] {
  const safeLimit = Math.max(limit, 1);
  const filtered = excludeMessageId
    ? rows.filter((line) => line.messageId !== excludeMessageId)
    : rows;

  const summary = filtered.find((line) => line.author === "conversation-summary");
  if (!summary) {
    return filtered.slice(-safeLimit);
  }

  if (safeLimit === 1) {
    return [summary];
  }

  const nonSummary = filtered.filter((line) => line.author !== "conversation-summary");
  return [summary, ...nonSummary.slice(-(safeLimit - 1))];
}

/**
 * Trims, deduplicates, and removes empty image URLs.
 *
 * @param imageUrls Raw image URL inputs provided by callers.
 * @returns Unique, non-empty image URLs in insertion order.
 */
function normalizeImageUrls(imageUrls: string[]): string[] {
  return [...new Set(imageUrls.map((url) => url.trim()).filter(Boolean))];
}

/**
 * Normalizes file inputs by trimming fields, dropping empty payloads, and deduplicating
 * exact filename/data pairs.
 *
 * @param files Raw file inputs attached to an AI request.
 * @returns Cleaned file inputs safe for request serialization.
 */
function normalizeInputFiles(files: AiInputFile[]): AiInputFile[] {
  const seen = new Set<string>();
  const normalized: AiInputFile[] = [];

  for (const file of files) {
    const filename = file.filename.trim() || "document.pdf";
    const fileData = file.fileData.trim();
    if (!fileData) {
      continue;
    }

    const key = `${filename}::${fileData}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push({
      filename,
      fileData,
      mimeType: file.mimeType?.trim() || undefined,
    });
  }

  return normalized;
}

/**
 * Trims and removes empty free-form text blocks before prompt assembly.
 *
 * @param blocks Raw supplemental text blocks.
 * @returns Non-empty text blocks with surrounding whitespace removed.
 */
function normalizeInputTextBlocks(blocks: string[]): string[] {
  return blocks
    .map((block) => block.trim())
    .filter(Boolean);
}

/**
 * Detects whether a file input should be treated as PDF content using MIME type,
 * filename extension, or inline data URL hints.
 *
 * @param file Candidate file attachment.
 * @returns True when the file appears to represent a PDF document.
 */
function isPdfFile(file: AiInputFile): boolean {
  const mimeType = file.mimeType?.toLowerCase() ?? "";
  if (mimeType.includes("application/pdf")) {
    return true;
  }

  if (file.filename.toLowerCase().endsWith(".pdf")) {
    return true;
  }

  const fileData = file.fileData.toLowerCase();
  if (fileData.startsWith("data:application/pdf;base64,")) {
    return true;
  }

  return /\.pdf(?:\?|$)/i.test(file.fileData);
}

/**
 * Builds a human-readable prompt metadata section from optional contextual flags.
 *
 * @param promptContext Optional metadata describing conversation or response intent.
 * @returns A formatted metadata section, or an empty string when no metadata is present.
 */
function buildPromptContextSection(promptContext?: PromptContextMeta): string {
  if (!promptContext) {
    return "";
  }

  const rows: string[] = [];
  if (promptContext.channelKind) {
    rows.push(`- Channel kind: ${promptContext.channelKind}`);
  }

  if (promptContext.responseMode) {
    rows.push(`- Response mode: ${promptContext.responseMode}`);
  }

  if (promptContext.instruction) {
    rows.push(`- Instruction: ${promptContext.instruction}`);
  }

  if (rows.length === 0) {
    return "";
  }

  return [
    "Conversation metadata:",
    ...rows,
  ].join("\n");
}

/**
 * Assembles the final user prompt, merging metadata, recent conversation context,
 * and the direct user request.
 *
 * @param prompt The user's direct prompt text.
 * @param channelContext Recent conversation lines to provide continuity.
 * @param promptContext Optional metadata for response behavior and channel context.
 * @returns The constructed prompt string to send to the model.
 */
function buildUserPrompt(
  prompt: string,
  channelContext: ConversationLine[],
  promptContext?: PromptContextMeta,
): string {
  const context = compactContext(channelContext);
  const contextSection = context.length > 0
    ? [
        "Recent conversation context:",
        context
          .map((line) => `${line.author}: ${line.content}`)
          .join("\n"),
      ].join("\n")
    : "";

  const metadataSection = buildPromptContextSection(promptContext);

  if (!contextSection && !metadataSection) {
    return prompt;
  }

  const sections = [metadataSection, contextSection].filter(Boolean);

  sections.push([
    "User request:",
    prompt,
  ].join("\n"));

  return sections.join("\n\n");
}

/**
 * Builds structured user message content with optional text blocks, image URLs,
 * and file attachments.
 *
 * @param prompt The user's direct prompt text.
 * @param channelContext Recent conversation context to embed.
 * @param promptContext Optional context metadata.
 * @param imageUrls Image URLs to include as multimodal inputs.
 * @param files Files to attach as structured file parts.
 * @param inputTextBlocks Additional text blocks appended to the user prompt.
 * @returns Either plain text content or multipart content depending on attachments.
 */
function buildUserContent(
  prompt: string,
  channelContext: ConversationLine[],
  promptContext: PromptContextMeta | undefined,
  imageUrls: string[],
  files: AiInputFile[],
  inputTextBlocks: string[],
): ChatMessageContent {
  const userPrompt = buildUserPrompt(prompt, channelContext, promptContext);
  const normalizedInputTextBlocks = normalizeInputTextBlocks(inputTextBlocks);
  const userText = normalizedInputTextBlocks.length > 0
    ? [
        userPrompt,
        ...normalizedInputTextBlocks,
      ].join("\n\n")
    : userPrompt;
  const normalizedImageUrls = normalizeImageUrls(imageUrls);
  const normalizedFiles = normalizeInputFiles(files);

  if (normalizedImageUrls.length === 0 && normalizedFiles.length === 0) {
    return userText;
  }

  return [
    {
      type: "text",
      text: userText,
    },
    ...normalizedImageUrls.map((url) => ({
      type: "image_url" as const,
      image_url: {
        url,
      },
    })),
    ...normalizedFiles.map((file) => ({
      type: "file" as const,
      file: {
        filename: file.filename,
        file_data: file.fileData,
      },
    })),
  ];
}

/**
 * Converts structured chat content into plain text for fallback providers that do not
 * accept the native ALabs mixed-part format.
 *
 * @param content Chat content in string or multipart representation.
 * @returns Plain text preserving textual content and attachment references when possible.
 */
function toFallbackTextContent(content: ChatMessageContent): string {
  if (typeof content === "string") {
    return content;
  }

  const textParts = content
    .filter((part): part is Extract<ChatContentPart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .filter(Boolean);

  const imageUrls = content
    .filter((part): part is Extract<ChatContentPart, { type: "image_url" }> => part.type === "image_url")
    .map((part) => part.image_url.url)
    .filter(Boolean);

  const fileReferences = content
    .filter((part): part is Extract<ChatContentPart, { type: "file" }> => part.type === "file")
    .map((part) => `${part.file.filename}: ${part.file.file_data}`)
    .filter(Boolean);

  const sections: string[] = [];
  if (textParts.length > 0) {
    sections.push(textParts.join("\n"));
  }

  if (imageUrls.length > 0) {
    sections.push(`Attached image URLs:\n${imageUrls.join("\n")}`);
  }

  if (fileReferences.length > 0) {
    sections.push(`Attached files:\n${fileReferences.join("\n")}`);
  }

  return sections.join("\n\n");
}

/**
 * Sends a completion request through Gemini as a fallback path when ALabs capacity is exhausted.
 *
 * @param messages Prepared chat messages originally destined for ALabs.
 * @param options Streaming and progress callback options.
 * @returns The normalized final completion text.
 * @throws {Error} When no Gemini client is configured for fallback usage.
 * @throws {Error} Propagates Gemini SDK errors from generation requests.
 */
async function askGeminiFallback(
  messages: ChatMessage[],
  options: Pick<AskAIOptions, "stream" | "onProgress">,
): Promise<string> {
  const client = createGeminiClient();
  if (!client) {
    throw new Error(
      "ALabs AI SDK quota appears exhausted and no GEMINI_API_KEY* fallback keys are configured.",
    );
  }

  const systemInstruction = toFallbackTextContent(
    messages.find((message) => message.role === "system")?.content ?? "",
  );
  const contents = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: toFallbackTextContent(message.content) }],
    }));

  if (options.stream && options.onProgress) {
    const stream = await client.models.generateContentStream({
      model: appConfig.geminiTextModel,
      contents,
      config: {
        systemInstruction,
        maxOutputTokens: appConfig.textMaxTokens,
        temperature: appConfig.textTemperature,
        topP: appConfig.textTopP,
      },
    });

    let accumulated = "";
    for await (const chunk of stream) {
      const delta = chunk.text ?? "";
      if (!delta) {
        continue;
      }

      accumulated += delta;
      await options.onProgress(accumulated);
    }

    const finalText = normalizeDiscordMessage(accumulated.trim() || "No response generated.");
    await options.onProgress(finalText);
    return finalText;
  }

  const response = await client.models.generateContent({
    model: appConfig.geminiTextModel,
    contents,
    config: {
      systemInstruction,
      maxOutputTokens: appConfig.textMaxTokens,
      temperature: appConfig.textTemperature,
      topP: appConfig.textTopP,
    },
  });

  const text = normalizeDiscordMessage(response.text?.trim() || "No response generated.");
  if (options.onProgress) {
    await options.onProgress(text);
  }

  return text;
}

/**
 * Executes the primary AI chat request against ALabs, with optional streaming,
 * multimodal inputs, memory injection, and Gemini fallback handling.
 *
 * @param prompt User prompt to process.
 * @param options Optional prompt/system/context/model configuration.
 * @returns The final normalized assistant response text.
 * @throws {SelectedAlabsModelUnavailableError} When an explicitly selected ALabs model is unavailable and fallback is not allowed.
 * @throws {Error} When the ALabs request fails for non-quota reasons.
 * @throws {Error} When streaming is requested but the response body is missing.
 * @throws {Error} Propagates network, timeout, and provider SDK errors.
 */
export async function askAI(prompt: string, options: AskAIOptions = {}): Promise<string> {
  const baseSystemPrompt =
    "You are Nyx, an AI assistant inside Discord. You were made by Aarav Labs and are powered by ALabs AI SDK. Give clear, concise, accurate responses.";

  const profileInstruction = options.userId
    ? buildCompanionProfileInstruction(await getUserProfile(options.userId))
    : null;

  const identityRequirement =
    "Identity requirement: You are Nyx, inside Discord, made by Aarav Labs and powered by ALabs AI SDK.";

  const systemPromptSections = [options.systemPrompt ?? baseSystemPrompt];
  if (profileInstruction) {
    systemPromptSections.push(profileInstruction);
  }

  if (options.systemPrompt) {
    systemPromptSections.push(identityRequirement);
  }

  const effectiveSystemPrompt = systemPromptSections.join("\n\n");

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: effectiveSystemPrompt,
    },
    ...compactMemory(options.userMemory ?? []).map((entry) => ({
      role: entry.role,
      content: entry.content,
    })),
    {
      role: "user",
      content: buildUserContent(
        prompt,
        options.channelContext ?? [],
        options.promptContext,
        options.imageUrls ?? [],
        [...(options.files ?? []), ...(options.pdfFiles ?? [])],
        options.inputTextBlocks ?? [],
      ),
    },
  ];

  const shouldStream = options.stream ?? Boolean(options.onProgress);
  const selectedModel = options.model?.trim() || appConfig.textModel;
  const normalizedFiles = normalizeInputFiles([...(options.files ?? []), ...(options.pdfFiles ?? [])]);
  const plugins: ChatCompletionPlugin[] =
    normalizedFiles.some((file) => isPdfFile(file))
      ? [
          {
            id: "file-parser",
            pdf: {
              engine: options.pdfEngine ?? "native",
            },
          },
        ]
      : [];

  const response = await fetch(`${appConfig.aiBaseUrl}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${appConfig.aiApiKey}`,
    },
    body: JSON.stringify({
      model: selectedModel,
      messages,
      ...(plugins.length > 0 ? { plugins } : {}),
      stream: shouldStream,
      max_tokens: appConfig.textMaxTokens,
      temperature: appConfig.textTemperature,
      top_p: appConfig.textTopP,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (isAlabsQuotaExhausted(response.status, errorText)) {
      if (options.model && options.model.trim() && options.model.trim() !== appConfig.textModel) {
        throw new SelectedAlabsModelUnavailableError();
      }

      return askGeminiFallback(messages, {
        stream: shouldStream,
        onProgress: options.onProgress,
      });
    }

    throw new Error(`AI request failed (${response.status}): ${errorText}`);
  }

  if (!shouldStream) {
    const completion = (await response.json()) as AlabsChatCompletionResponse;
    return normalizeDiscordMessage(
      completion.choices?.[0]?.message?.content?.trim() || "No response generated.",
    );
  }

  if (!response.body) {
    throw new Error("AI streaming failed: empty response body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";
  let buffer = "";

  const processSseLine = async (rawLine: string): Promise<void> => {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) {
      return;
    }

    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") {
      return;
    }

    try {
      const parsed = JSON.parse(payload) as AlabsStreamChunk;
      const delta =
        parsed.choices?.[0]?.delta?.content ??
        parsed.choices?.[0]?.message?.content ??
        "";

      if (!delta) {
        return;
      }

      accumulated += delta;
      if (options.onProgress) {
        await options.onProgress(accumulated);
      }
    } catch {
      return;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      await processSseLine(rawLine);
    }
  }

  // Flush any buffered decoder bytes and process a final non-newline-terminated SSE line.
  buffer += decoder.decode();
  if (buffer.trim()) {
    await processSseLine(buffer);
  }

  const finalText = normalizeDiscordMessage(accumulated.trim() || "No response generated.");
  if (options.onProgress) {
    await options.onProgress(finalText);
  }

  return finalText;
}

/**
 * Generates a concise, natural Discord-style reply from a source message.
 *
 * @param message Source message to reply to.
 * @param options Optional AI settings excluding custom system prompt.
 * @returns Generated reply text.
 * @throws {Error} Propagates errors from the underlying AI request pipeline.
 */
export async function generateReply(
  message: string,
  options: Omit<AskAIOptions, "systemPrompt"> = {},
): Promise<string> {
  return askAI(`Write a natural reply to:\n${message}`, {
    ...options,
    systemPrompt:
      "You generate helpful, friendly Discord replies that are concise and context-aware.",
  });
}

/**
 * Produces a clear explanation for arbitrary input text.
 *
 * @param text Text that should be explained.
 * @param options Optional AI settings excluding custom system prompt.
 * @returns Explanatory response text.
 * @throws {Error} Propagates errors from the underlying AI request pipeline.
 */
export async function explain(
  text: string,
  options: Omit<AskAIOptions, "systemPrompt"> = {},
): Promise<string> {
  return askAI(`Explain this clearly:\n${text}`, {
    ...options,
    systemPrompt:
      "You explain text clearly and accurately, using simple language when helpful.",
  });
}

/**
 * Retrieves recent channel conversation lines suitable for prompt context, with optional
 * summary insertion for older messages and short-lived per-channel caching.
 *
 * @param channel Discord text-capable channel, or null when unavailable.
 * @param limit Maximum number of context lines to return.
 * @param options Retrieval and filtering flags for bot messages, summary behavior, and fetch size.
 * @returns Context lines in chronological order, potentially including a summary row.
 */
export async function getRecentConversationContext(
  channel: TextBasedChannel | null,
  limit = MAX_CONTEXT_LINES,
  options: ConversationContextOptions = {},
): Promise<ConversationLine[]> {
  if (!channel || !("messages" in channel)) {
    return [];
  }

  const channelId = "id" in channel && typeof channel.id === "string" ? channel.id : null;
  const now = Date.now();

  const cacheKey = channelId
    ? buildContextCacheKey(channelId, limit, {
        includeBotMessages: options.includeBotMessages,
        includeSummaryOfOlderMessages: options.includeSummaryOfOlderMessages,
        maxFetchMessages: options.maxFetchMessages,
      })
    : null;

  if (cacheKey) {
    const cached = channelContextCache.get(cacheKey);
    if (cached) {
      if (cached.expiresAt > now && cached.rows.length > 0) {
        return finalizeContextRows(cached.rows, limit, options.excludeMessageId);
      }

      if (cached.pending) {
        const rows = await cached.pending;
        return finalizeContextRows(rows, limit, options.excludeMessageId);
      }
    }
  }

  const pending = (async (): Promise<ConversationLine[]> => {
    let fetched: any[];
    try {
      const desiredFetch = Math.max(limit * 2, 10);
      const boundedFetch = options.maxFetchMessages
        ? Math.max(desiredFetch, Math.min(options.maxFetchMessages, 200))
        : desiredFetch;

      const recent = await channel.messages.fetch({
        limit: boundedFetch,
      });
      fetched = [...recent.values()];
    } catch (error) {
      console.warn("Failed to fetch conversation context, continuing without context:", error);
      return [];
    }

    const filtered = fetched
      .filter((message: any) => {
        if (!message) return false;
        if (message.author?.bot && !options.includeBotMessages) return false;
        if (message.system) return false;
        if (!message.content?.trim()) return false;
        return true;
      })
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    const normalized = filtered.map((message) => ({
      author: message.author.bot
        ? `assistant:${message.author.username}`
        : `user:${message.author.username}`,
      content: message.content,
      messageId: message.id,
    }));

    const capped = normalized.slice(-Math.max(limit, 1));
    if (!options.includeSummaryOfOlderMessages || normalized.length <= capped.length) {
      return capped;
    }

    const older = normalized.slice(0, normalized.length - capped.length);
    const summary = buildOlderConversationSummary(older);
    if (!summary) {
      return capped;
    }

    return [
      {
        author: "conversation-summary",
        content: summary,
      },
      ...capped,
    ];
  })();

  if (cacheKey) {
    channelContextCache.set(cacheKey, {
      expiresAt: now + CONTEXT_CACHE_TTL_MS,
      rows: [],
      pending,
    });
  }

  try {
    const rows = await pending;
    if (cacheKey) {
      channelContextCache.set(cacheKey, {
        expiresAt: Date.now() + CONTEXT_CACHE_TTL_MS,
        rows,
      });
    }

    return finalizeContextRows(rows, limit, options.excludeMessageId);
  } catch {
    if (cacheKey) {
      channelContextCache.delete(cacheKey);
    }

    return [];
  }
}
