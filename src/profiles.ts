import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

interface Config {
  profiles: Record<string, { key: string }>;
  lastGateway?: string;
  lastModels?: string[];
}

export const CONFIG_PATH = join(homedir(), ".config", "9agent", "config.json");

function profileName(gateway: string): string {
  return gateway.replace(/\/+$/, "");
}

function readConfig(path: string): Config {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return { profiles: {} };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Config>;
    return { profiles: parsed.profiles ?? {} };
  } catch {
    throw new Error(`${path} is not valid JSON — fix or delete it, then retry.`);
  }
}

export function savedKey(gateway: string, path: string = CONFIG_PATH): string | undefined {
  return readConfig(path).profiles[profileName(gateway)]?.key;
}

export function saveKey(gateway: string, key: string, path: string = CONFIG_PATH): void {
  const config = readConfig(path);
  config.profiles[profileName(gateway)] = { key };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

export function getLastGateway(path: string = CONFIG_PATH): string | undefined {
  return readConfig(path).lastGateway;
}

export function setLastGateway(gateway: string, path: string = CONFIG_PATH): void {
  const config = readConfig(path);
  config.lastGateway = gateway;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

export function getLastModels(path: string = CONFIG_PATH): string[] | undefined {
  return readConfig(path).lastModels;
}

export function setLastModels(models: string[], path: string = CONFIG_PATH): void {
  const config = readConfig(path);
  config.lastModels = models;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}
