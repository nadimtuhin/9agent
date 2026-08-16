import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { AgentAdapter, LaunchOptions } from "./base.js";
import { runHost } from "../runner/host.js";
import { piSpec, resolveImage, runSandbox, writeShadowConfig } from "../runner/sandbox.js";

const execFileAsync = promisify(execFile);

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
        "pi: --yolo is a no-op; Pi has no built-in permission system. Run sandboxed externally if needed.",
      );
    }

    await runHost("pi", args, {});
  },
};
