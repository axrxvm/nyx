import { GoogleGenAI } from "@google/genai";
import { appConfig } from "../config";

const QUOTA_PATTERNS = [
  /quota/i,
  /rate\s*limit/i,
  /exhaust/i,
  /insufficient/i,
  /billing/i,
  /credits?/i,
  /too many requests/i,
  /resource[_\s-]*exhausted/i,
];

const geminiClientsByKey = new Map<string, GoogleGenAI>();

export function isAlabsQuotaExhausted(status: number, responseBody: string): boolean {
  if (status === 429 || status === 402) {
    return true;
  }

  if (status < 400) {
    return false;
  }

  return QUOTA_PATTERNS.some((pattern) => pattern.test(responseBody));
}

export function getRandomGeminiApiKey(): string | null {
  if (appConfig.geminiApiKeys.length === 0) {
    return null;
  }

  const randomIndex = Math.floor(Math.random() * appConfig.geminiApiKeys.length);
  return appConfig.geminiApiKeys[randomIndex] ?? null;
}

export function createGeminiClient(): GoogleGenAI | null {
  const key = getRandomGeminiApiKey();
  if (!key) {
    return null;
  }

  const cached = geminiClientsByKey.get(key);
  if (cached) {
    return cached;
  }

  const client = new GoogleGenAI({ apiKey: key });
  geminiClientsByKey.set(key, client);
  return client;
}
