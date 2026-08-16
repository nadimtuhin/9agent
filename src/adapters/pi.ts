import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { AgentAdapter, LaunchOptions } from "./base.js";
import { runHost } from "../runner/host.js";
import { piSpec, resolveImage, runSandbox, writeShadowConfig } from "../runner/sandbox.js";

const execFileAsync = promisify(execFile);

/**
 * Whether pi's own config knows this model id.
 *
 * 9agent offers every model the Gateway serves; pi only knows what is listed in
 * models.json, and silently falls back to default context limits for anything
 * else. Routing still works — the id passes through to 9Router — but pi is
 * guessing at contextWindow, maxTokens, and image support.
 *
 * Read-only by design: warn, never rewrite the user's file (ADR-0001).
 * `undefined` means "cannot tell", which must not produce a warning.
 */
export function piKnowsModel(configText: string, model: string): boolean | undefined {
  let ids: string[];
  try {
    const cfg = JSON.parse(configText) as {
      providers?: Record<string, { models?: { id?: string }[] }>;
    };
    ids = Object.values(cfg.providers ?? {}).flatMap((p) =>
      (p.models ?? []).map((m) => m.id ?? ""),
    );
  } catch {
    return undefined; // malformed config is pi's problem to report, not ours
  }
  if (ids.length === 0) return undefined;
  return ids.includes(model);
}

export function buildPiArgs(opts: {
  model: string;
  yolo: boolean;
  extraArgs: string[];
}): string[] {
  // yolo is a confirmed no-op: Pi has no built-in permission system
  return ["--provider", "9router", "--model", opts.model, ...opts.extraArgs];
}

export const piAdapter: AgentAdapter = {
  name: "pi",
  aliases: ["p"],
  supportsSandbox: true,
  async detect() {
    return new Promise((resolve) => {
      execFileAsync("which", ["pi"])
        .then(() => resolve(true))
        .catch(() => resolve(false));
    });
  },
  async launch(opts: LaunchOptions) {
    const args = buildPiArgs(opts);

    // Warn before the dry-run guard: --print-only must show every warning a
    // real launch would print.
    const modelsJson = join(piSpec().agentHome, "agent", "models.json");
    if (existsSync(modelsJson)) {
      const known = piKnowsModel(readFileSync(modelsJson, "utf-8"), opts.model);
      if (known === false) {
        console.error(
          `pi: ${opts.model} is not listed in ${modelsJson}, so pi will treat it as a ` +
            `custom id and guess its context limits. Routing still works. Add it there to fix the limits.`,
        );
      }
    }

    if (opts.sandbox) {
      // Pi routes via models.json, so the container needs a copy whose gateway
      // points at the host. The user's own file is only ever read.
      const spec = piSpec();
      const source = join(spec.agentHome, "agent", "models.json");
      if (!existsSync(source)) {
        throw new Error(
          `pi: --sandbox needs ${source}, which does not exist. Seed your 9router provider first.`,
        );
      }
      const shadow = writeShadowConfig("pi", "models.json", source);
      const mount = `${shadow}:${spec.containerHome}/agent/models.json:ro`;

      if (opts.dryRun) {
        console.error("--- pi sandbox dry run ---");
        console.error("shadow config:", shadow);
        console.error("image:", resolveImage(spec));
        console.error("args:", args);
        return;
      }
      console.error(`pi: launching sandboxed with model=${opts.model}`);
      await runSandbox(spec, "pi", args, {}, [mount]);
      return;
    }

    if (opts.dryRun) {
      console.error("--- pi dry run ---");
      console.error("args:", args);
      console.error(
        "(pi uses models.json for gateway routing, not env vars)",
      );
      return;
    }

    // Pi env only carries provider API keys, not base URL.
    // Custom gateway needs models.json seeding (v2).
    const expected = "http://localhost:20128/v1";
    if (opts.baseUrl !== expected) {
      console.error(
        `pi: base URL is ${opts.baseUrl}, expected ${expected}. Custom gateway needs models.json seeding (v2).`,
      );
    }

    if (opts.yolo) {
      console.error(
        "pi: --yolo is a no-op; Pi has no built-in permission system. Pass --sandbox to bound the blast radius.",
      );
    }

    await runHost("pi", args, {});
  },
};
