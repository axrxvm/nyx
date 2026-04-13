import { askAI } from "./ai";
import type { AskAIOptions, ConversationLine } from "./ai";
import type { MemoryEntry } from "./memory";

interface SummarizeOptions {
  channelContext?: ConversationLine[];
  promptContext?: AskAIOptions["promptContext"];
  userMemory?: MemoryEntry[];
  userId?: string;
  imageUrls?: string[];
  files?: AskAIOptions["files"];
  inputTextBlocks?: AskAIOptions["inputTextBlocks"];
  pdfEngine?: AskAIOptions["pdfEngine"];
  stream?: boolean;
  onProgress?: AskAIOptions["onProgress"];
}

export async function summarizeText(
  text: string,
  options: SummarizeOptions = {},
): Promise<string> {
  return askAI(`Summarize this text:\n${text}`, {
    ...options,
    systemPrompt:
      "You summarize content clearly and concisely. Use short paragraphs or bullets when useful.",
  });
}
