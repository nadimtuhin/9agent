import { execFile } from "node:child_process";
import { REGISTRY } from "./adapters/base.js";
import type { AgentAdapter } from "./adapters/base.js";
import { dockerCommand } from "./runner/sandbox.js";

export type CheckStatus = "ok" | "warn" | "fail";

export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}

export type DoctorExec = (
  cmd: string,
  args: string[],
) => Promise<{ status: number; stdout: string }>;

export interface DoctorDeps {
  gateway: string;
  keySource: string;
  key?: string;
  adapters: AgentAdapter[];
  fetchFn: typeof fetch;
  exec: DoctorExec;
}

export interface DoctorResult {
  checks: Check[];
  report: string;
  exitCode: number;
}

const MARKER: Record<CheckStatus, string> = { ok: "✔", warn: "!", fail: "✘" };

const execExec: DoctorExec = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, (err, stdout) => {
      resolve({
        status: err ? ((err as { code?: number }).code ?? 1) : 0,
        stdout,
      });
    });
  });

export function resolveKeySource(flag?: string): string {
  if (flag) return "--key";
  if (process.env.NINEROUTER_KEY) return "NINEROUTER_KEY";
  if (process.env.LOCAL_9ROUTER_KEY) return "LOCAL_9ROUTER_KEY";
  return "default";
}

async function checkGateway(deps: DoctorDeps): Promise<Check> {
  const url = `${deps.gateway}/models`;
  let res: Response;
  try {
    res = await deps.fetchFn(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name: "gateway", status: "fail", detail: `${url} unreachable (${msg})` };
  }
  if (!res.ok) {
    return { name: "gateway", status: "fail", detail: `${url} returned HTTP ${res.status}` };
  }
  let count = 0;
  try {
    const body = (await res.json()) as { data?: unknown[] };
    count = Array.isArray(body.data) ? body.data.length : 0;
  } catch {
    return { name: "gateway", status: "fail", detail: `${url} returned HTTP ${res.status} with invalid JSON` };
  }
  return {
    name: "gateway",
    status: "ok",
    detail: `${url} HTTP ${res.status}, ${count} model${count === 1 ? "" : "s"}`,
  };
}

function checkKey(deps: DoctorDeps): Check {
  if (!deps.key || deps.key === "sk_9router") {
    return {
      name: "key",
      status: "warn",
      detail: `using the local placeholder (source: ${deps.keySource}) — a real key is needed for --sandbox`,
    };
  }
  return { name: "key", status: "ok", detail: `resolved from ${deps.keySource} (value not shown)` };
}

async function checkAgents(deps: DoctorDeps): Promise<Check> {
  const installed: string[] = [];
  const missing: string[] = [];
  for (const a of deps.adapters) {
    (((await a.detect()) ? installed : missing)).push(a.name);
  }
  if (installed.length === 0) {
    return { name: "agents", status: "fail", detail: `none installed (looked for: ${missing.join(", ")})` };
  }
  return { name: "agents", status: "ok", detail: `installed: ${installed.join(", ")}` };
}

async function checkDocker(deps: DoctorDeps): Promise<Check> {
  const [bin, ...prefix] = dockerCommand();
  const which = await deps.exec(bin, [...prefix, "--version"]);
  if (which.status !== 0) {
    return { name: "docker", status: "warn", detail: "not found on PATH — only needed for --sandbox" };
  }
  const info = await deps.exec(bin, [...prefix, "info"]);
  if (info.status !== 0) {
    return { name: "docker", status: "warn", detail: "installed, but the daemon is not responding — only needed for --sandbox" };
  }
  return { name: "docker", status: "ok", detail: "daemon responding" };
}

export async function runDoctor(deps: DoctorDeps): Promise<DoctorResult> {
  const checks: Check[] = [
    await checkGateway(deps),
    checkKey(deps),
    await checkAgents(deps),
    await checkDocker(deps),
  ];

  const width = Math.max(...checks.map((c) => c.name.length));
  const report =
    checks
      .map((c) => `${MARKER[c.status]} ${c.name.padEnd(width)}  ${c.detail}`)
      .join("\n") + "\n";

  return { checks, report, exitCode: checks.some((c) => c.status === "fail") ? 1 : 0 };
}

export function defaultDoctorDeps(opts: { gateway: string; key: string; keyFlag?: string }): DoctorDeps {
  return {
    gateway: opts.gateway,
    keySource: resolveKeySource(opts.keyFlag),
    key: opts.key,
    adapters: REGISTRY,
    fetchFn: fetch,
    exec: execExec,
  };
}
