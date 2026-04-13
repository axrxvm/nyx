import { appConfig } from "../config";

interface ModerationResultShape {
  flagged?: boolean;
  categories?: Record<string, boolean>;
  category_scores?: Record<string, number>;
}

interface ModerationResponseShape {
  model?: string;
  results?: ModerationResultShape[];
}

export interface ModerationResult {
  model: string;
  flagged: boolean;
  triggeredCategories: string[];
  topScores: Array<{ category: string; score: number }>;
}

const MODERATION_TIMEOUT_MS = 20_000;

export async function moderateText(input: string): Promise<ModerationResult> {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Moderation input cannot be empty.");
  }

  const response = await fetch(`${appConfig.aiBaseUrl}/moderations`, {
    method: "POST",
    signal: AbortSignal.timeout(MODERATION_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${appConfig.aiApiKey}`,
    },
    body: JSON.stringify({ input: trimmed }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Moderation request failed (${response.status}): ${errorBody}`);
  }

  const payload = (await response.json()) as ModerationResponseShape;
  const first = payload.results?.[0];
  if (!first) {
    throw new Error("Moderation API returned no results.");
  }

  const categories = first.categories ?? {};
  const scores = first.category_scores ?? {};

  const triggeredCategories = Object.entries(categories)
    .filter(([, isTriggered]) => Boolean(isTriggered))
    .map(([name]) => name);

  const topScores = Object.entries(scores)
    .map(([category, score]) => ({ category, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return {
    model: payload.model ?? "omni-moderation-latest",
    flagged: Boolean(first.flagged),
    triggeredCategories,
    topScores,
  };
}
