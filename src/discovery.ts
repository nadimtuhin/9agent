import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ModelEntry {
  id: string;
  owned_by: string;
  context_window?: number;
  max_tokens?: number;
}

const CACHE_PATH = join(homedir(), ".config", "9agent", "models.json");

function readCache(): ModelEntry[] | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
    if (!Array.isArray(parsed)) return null;
    const ok = parsed.every(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        typeof (m as ModelEntry).id === "string" &&
        typeof (m as ModelEntry).owned_by === "string",
    );
    return ok ? (parsed as ModelEntry[]) : null;
  } catch {
    return null;
  }
}

function writeCache(models: ModelEntry[]): void {
  try {
    mkdirSync(join(CACHE_PATH, ".."), { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify(models, null, 2), "utf-8");
  } catch {
    // Best-effort — never block launch on cache write
  }
}

export async function discoverModels(
  baseUrl: string,
  apiKey: string,
): Promise<ModelEntry[]> {
  // ponytail: only a transport/HTTP failure means "offline". A bad payload is a
  // real bug and must not be masked by serving stale cache.
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    const cached = readCache();
    if (cached) return cached;
    throw new Error(
      `Cannot reach ${baseUrl}/models and no cached models at ${CACHE_PATH}. Is 9Router running?`,
    );
  }

  const body = (await res.json()) as { data?: ModelEntry[] };
  if (!Array.isArray(body.data)) {
    throw new Error(`${baseUrl}/models returned no 'data' array`);
  }
  const models = body.data.map((m) => ({
    id: m.id,
    owned_by: m.owned_by,
    ...("context_window" in m ? { context_window: m.context_window } : {}),
    ...("max_tokens" in m ? { max_tokens: m.max_tokens } : {}),
  }));

  writeCache(models);
  return models;
}
