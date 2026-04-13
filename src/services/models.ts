import { appConfig } from "../config";

interface ModelsResponseShape {
  data?: Array<{
    id?: string;
    owned_by?: string;
    created?: number;
  }>;
  models?: Array<{
    id?: string;
    owned_by?: string;
    created?: number;
  }>;
}

export interface AvailableModel {
  id: string;
  ownedBy?: string;
  created?: number;
}

const MODEL_ENDPOINTS = ["/models", "/get-models"];
const MODELS_REQUEST_TIMEOUT_MS = 20_000;

function normalizeModels(payload: unknown): AvailableModel[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const response = payload as ModelsResponseShape;
  const rows = response.data ?? response.models ?? [];
  const models: AvailableModel[] = [];

  for (const row of rows) {
    if (!row?.id) {
      continue;
    }

    models.push({
      id: row.id,
      ownedBy: row.owned_by,
      created: row.created,
    });
  }

  return models;
}

export async function fetchAvailableModels(limit = 20): Promise<AvailableModel[]> {
  let lastError: string | null = null;

  for (const endpoint of MODEL_ENDPOINTS) {
    try {
      const response = await fetch(`${appConfig.aiBaseUrl}${endpoint}`, {
        method: "GET",
        signal: AbortSignal.timeout(MODELS_REQUEST_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${appConfig.aiApiKey}`,
        },
      });

      if (!response.ok) {
        lastError = `${endpoint} => ${response.status}`;
        continue;
      }

      const payload = (await response.json()) as unknown;
      const models = normalizeModels(payload);
      if (models.length === 0) {
        lastError = `${endpoint} => empty model list`;
        continue;
      }

      const unique = [...new Map(models.map((model) => [model.id, model])).values()];
      return unique.slice(0, Math.max(1, limit));
    } catch (error) {
      lastError = `${endpoint} => ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  throw new Error(`Failed to fetch model list from ALabs AI SDK. ${lastError ?? "No response."}`);
}
