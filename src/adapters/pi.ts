import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { AgentAdapter, LaunchOptions } from "./base.js";
import { runHost } from "../runner/host.js";
import { piSpec, resolveImage, runSandbox, writeShadowConfig } from "../runner/sandbox.js";

const execFileAsync = promisify(execFile);

interface ModelConfig {
  providers: Record<string, { models: { id: string; contextWindow?: number }[] }>;
}

export function patchContextConfig(
  configText: string,
  modelId: string,
  contextWindow: number,
): string {
  let cfg: ModelConfig;
  try {
    cfg = JSON.parse(configText) as ModelConfig;
  } catch {
    return configText;
  }

  let changed = false;
  for (const provider of Object.values(cfg?.providers ?? {})) {
    if (!provider.models) continue;
    const entry = provider.models.find((m) => m.id === modelId);
    if (entry && entry.contextWindow !== contextWindow) {
      entry.contextWindow = contextWindow;
      changed = true;
      break;
    }
  }
  if (!changed) return configText;
  return JSON.stringify(cfg, null, 2);
}

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
    return undefined;
  }
  if (ids.length === 0) return undefined;
  return ids.includes(model);
}

export function buildPiArgs(opts: {
  model: string;
  yolo: boolean;
  extraArgs: string[];
}): string[] {
  return ["--provider", "9router", "--model", opts.model, ...opts.extraArgs];
}

function syncModelConfig(modelsJson: string, opts: LaunchOptions): void {
  if (!existsSync(modelsJson)) return;
  const current = readFileSync(modelsJson, "utf-8");
  const known = piKnowsModel(current, opts.model);
  if (known === false) {
    console.error(
      `pi: ${opts.model} is not in ${modelsJson} — pi will guess context limits. ` +
        `Add it there to fix.`,
    );
  }
  if (opts.contextWindow !== undefined && known) {
    writeFileSync(modelsJson, patchContextConfig(current, opts.model, opts.contextWindow), "utf-8");
  }
}

export const piAdapter: AgentAdapter = {
  name: "pi",
  aliases: ["p"],
  supportsSandbox: true,
  async detect() {
    return new Promise((resolve) => {
      execFileAsync("which", ["pi"])
        .then(() => { resolve(true); })
        .catch(() => { resolve(false); });
    });
  },
  async launch(opts: LaunchOptions) {
    const args = buildPiArgs(opts);

    if (!opts.dryRun && !opts.sandbox) {
      syncModelConfig(join(piSpec().agentHome, "agent", "models.json"), opts);
    }

    if (opts.sandbox) {
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

    const expected = "http://localhost:20128/v1";
    if (opts.baseUrl !== expected) {
      console.error(
        `pi: base URL is ${opts.baseUrl} — pi routes via models.json, not env vars.`,
      );
    }

    await runHost("pi", args, {});
  },
};
