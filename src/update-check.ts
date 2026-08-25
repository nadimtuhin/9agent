import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CACHE_DIR = join(homedir(), ".commandcode", "update");
const CACHE_FILE = join(CACHE_DIR, "update-check.json");
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
  lastCheck: number;
  latest: string;
}

export type Fetcher = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

async function fetchLatest(
  fetcher?: Fetcher,
): Promise<string | null> {
  const fn: Fetcher = fetcher ?? ((url: string) => fetch(url));
  try {
    const res = await fn("https://registry.npmjs.org/9agent/latest");
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

function readCache(): CacheEntry | null {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf-8")) as CacheEntry;
  } catch {
    return null;
  }
}

function writeCache(latest: string): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ lastCheck: Date.now(), latest }));
  } catch {
    void 0;
  }
}

export interface UpdateCheckResult {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

export async function checkForUpdate(
  currentVersion: string,
  opts: { fetcher?: Fetcher; skipCache?: boolean } = {},
): Promise<UpdateCheckResult> {
  const cached = readCache();
  const cacheFresh =
    cached && Date.now() - cached.lastCheck < CHECK_INTERVAL_MS;

  let latest: string;
  if (cacheFresh && !opts.skipCache) {
    latest = cached.latest;
  } else {
    const fetched = await fetchLatest(opts.fetcher);
    if (fetched) {
      latest = fetched;
      writeCache(fetched);
    } else {
      latest = cached?.latest ?? currentVersion;
    }
  }

  return {
    current: currentVersion,
    latest,
    updateAvailable: latest !== currentVersion,
  };
}

export function printUpdateNotice(result: UpdateCheckResult): void {
  if (!result.updateAvailable) return;
  const useColor =
    (process.stderr.isTTY ?? false) && !("NO_COLOR" in process.env);
  const line1 = `⬆  9agent ${result.latest} is available (you have ${result.current})`;
  const line2 = `   Run 9agent update to upgrade.`;
  if (useColor) {
    process.stderr.write(
      `\x1b[33m${line1}\x1b[0m\n` +
      `\x1b[33m   Run \x1b[1m9agent update\x1b[0m\x1b[33m to upgrade.\x1b[0m\n`,
    );
  } else {
    process.stderr.write(`${line1}\n${line2}\n`);
  }
}
