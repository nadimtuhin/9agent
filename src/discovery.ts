import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ModelEntry {
  id: string;
  owned_by: string;
  context_window?: number;
  max_tokens?: number;
}

export const CACHE_PATH = join(homedir(), ".config", "9agent", "models.json");

export function isModelEntryArray(x: unknown): x is ModelEntry[] {
  return (
    Array.isArray(x) &&
    x.every(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        typeof (m as ModelEntry).id === "string" &&
        typeof (m as ModelEntry).owned_by === "string",
    )
  );
}

function readCache(path: string): ModelEntry[] | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    return isModelEntryArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(path: string, models: ModelEntry[]): void {
  try {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, JSON.stringify(models, null, 2), "utf-8");
  } catch {
    // Best-effort — never block launch on cache write
  }
}

export async function discoverModels(
  baseUrl: string,
  apiKey: string,
  cachePath: string = CACHE_PATH,
): Promise<ModelEntry[]> {
  // ponytail: only a transport failure means "offline". An HTTP status (401, 500)
  // or a bad payload is a real error and must surface, not be masked by cache.
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    const cached = readCache(cachePath);
    if (cached) {
      console.error(
        `9agent: cannot reach ${baseUrl}/models — serving ${cached.length} models from cache at ${cachePath}. It may be stale.`,
      );
      return cached;
    }
    throw new Error(
      `Cannot reach ${baseUrl}/models and no cached models at ${cachePath}. Is 9Router running?`,
    );
  }

  if (!res.ok) {
    throw new Error(`${baseUrl}/models returned HTTP ${res.status}`);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(`${baseUrl}/models returned invalid JSON`);
  }

  const data = (body as { data?: unknown })?.data;
  if (!isModelEntryArray(data)) {
    throw new Error(`${baseUrl}/models returned no valid 'data' array`);
  }

  const models = data.map((m) => ({
    id: m.id,
    owned_by: m.owned_by,
    ...("context_window" in m ? { context_window: m.context_window } : {}),
    ...("max_tokens" in m ? { max_tokens: m.max_tokens } : {}),
  }));

  writeCache(cachePath, models);
  return models;
}
