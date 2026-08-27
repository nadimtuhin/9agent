import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { assertModelExists } from "./opts.js";

export interface ModelEntry {
  id: string;
  owned_by: string;
  context_window?: number;
  max_tokens?: number;
}

export const CACHE_PATH = join(homedir(), ".config", "9agent", "models.json");

export function filterModels(models: ModelEntry[], input: string): ModelEntry[] {
  const q = input.trim().toLowerCase();
  if (q === "") return models;
  return models.filter(
    (m) =>
      m.id.toLowerCase().includes(q) || m.owned_by.toLowerCase().includes(q),
  );
}

export interface ResolvedModel {
  model: string;
  warning?: string;
  contextWindow?: number;
}

export async function resolveExplicitModel(
  flag: string,
  modelsPromise: Promise<ModelEntry[]>,
  stream: HintTarget,
): Promise<ResolvedModel> {
  let models: ModelEntry[];
  try {
    models = await awaitModels(modelsPromise, { stream, isTTY: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      model: flag,
      warning: `9agent: gateway unreachable (${msg}) — launching '${flag}' anyway.`,
    };
  }
  assertModelExists(flag, models.map((m) => m.id));
  const entry = models.find((m) => m.id === flag);
  return {
    model: flag,
    ...(entry?.context_window !== undefined ? { contextWindow: entry.context_window } : {}),
  };
}

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

function normalizeModel(m: ModelEntry): ModelEntry {
  return {
    id: m.id,
    owned_by: m.owned_by,
    ...("context_window" in m ? { context_window: m.context_window } : {}),
    ...("max_tokens" in m ? { max_tokens: m.max_tokens } : {}),
  };
}

function serveFromCache(cachePath: string, prefix: string): ModelEntry[] | null {
  const cached = readCache(cachePath);
  if (cached && cached.length > 0) {
    console.error(
      `${prefix} — serving ${cached.length} models from cache at ${cachePath}. It may be stale.`,
    );
    return cached;
  }
  return null;
}

function writeCache(path: string, models: ModelEntry[]): void {
  try {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, JSON.stringify(models, null, 2), "utf-8");
  } catch (_e: unknown) { void _e; }
}

export interface HintTarget {
  write: (s: string) => boolean;
}

export async function awaitModels(
  pending: Promise<ModelEntry[]>,
  opts: { stream: HintTarget; isTTY: boolean },
): Promise<ModelEntry[]> {
  let settled = false;
  pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await new Promise((r) => {
    setImmediate(r);
  });

  if (settled || !opts.isTTY) return pending;

  opts.stream.write("Loading models…");
  try {
    return await pending;
  } finally {
    opts.stream.write("\r\x1b[K");
  }
}

export async function discoverModels(
  baseUrl: string,
  apiKey: string,
  cachePath: string = CACHE_PATH,
): Promise<ModelEntry[]> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    const cached = serveFromCache(cachePath, `9agent: cannot reach ${baseUrl}/models`);
    if (cached) return cached;
    throw new Error(
      `Cannot reach ${baseUrl}/models and no cached models at ${cachePath}. Is 9Router running?`,
    );
  }

  if (!res.ok && res.status >= 500) {
    const cached = serveFromCache(cachePath, `9agent: ${baseUrl}/models returned HTTP ${res.status}`);
    if (cached) return cached;
  }
  if (!res.ok) throw new Error(`${baseUrl}/models returned HTTP ${res.status}`);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(`${baseUrl}/models returned invalid JSON`);
  }

  const models = parseModels(body, baseUrl);
  writeCache(cachePath, models);
  return models;
}

function parseModels(body: unknown, baseUrl: string): ModelEntry[] {
  const data = (body as { data?: unknown })?.data;
  if (!isModelEntryArray(data)) {
    throw new Error(`${baseUrl}/models returned no valid 'data' array`);
  }
  return data.map(normalizeModel);
}
