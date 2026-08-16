import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { AgentAdapter, LaunchOptions } from "./base.js";
import { runHost } from "../runner/host.js";
import {
  hermesCheckout,
  hermesSpec,
  resolveImage,
  runSandbox,
  writeShadowConfig,
} from "../runner/sandbox.js";

const execFileAsync = promisify(execFile);

export function buildHermesArgs(opts: {
  model: string;
  yolo: boolean;
  extraArgs: string[];
}): string[] {
  // --safe-mode is NOT the inverse of --yolo (it disables customizations);
  // safe mode is simply the absence of --yolo.
  return [
    "chat",
    "-m",
    opts.model,
    "--provider",
    "9router",
    ...(opts.yolo ? ["--yolo"] : []),
    ...opts.extraArgs,
  ];
}

export const hermesAdapter: AgentAdapter = {
  name: "hermes",
  aliases: ["h"],
  // Sandboxed by building upstream's own image from the local checkout — they
  // block pip/wheel installs, so a Dockerfile of ours could never work.
  supportsSandbox: true,
  async detect() {
    try {
      await execFileAsync("which", ["hermes"]);
      return true;
    } catch {
      return false;
    }
  },
  async launch(opts: LaunchOptions) {
    const args = buildHermesArgs(opts);

    if (opts.sandbox) {
      const spec = hermesSpec();
      if (!existsSync(spec.dockerfile)) {
        throw new Error(
          `hermes: --sandbox needs hermes' own checkout at ${hermesCheckout()} — ` +
            `upstream blocks pip installs, so their Dockerfile is the only way to ` +
            `build the image. Clone it there, or run without --sandbox.`,
        );
      }
      // Hermes routes via config.yaml, so the container needs a copy whose
      // provider URLs point at the host. The user's own file is only ever read.
      const source = join(spec.agentHome, "config.yaml");
      if (!existsSync(source)) {
        throw new Error(
          `hermes: --sandbox needs ${source}, which does not exist. Define your 9router provider first.`,
        );
      }
      const shadow = writeShadowConfig("hermes", "config.yaml", source);
      const mount = `${shadow}:${spec.containerHome}/config.yaml:ro`;

      if (opts.dryRun) {
        console.error("--- hermes sandbox dry run ---");
        console.error("shadow config:", shadow);
        console.error("image:", resolveImage(spec));
        console.error("args:", args);
        return;
      }
      console.error(`hermes: launching sandboxed with model=${opts.model}`);
      await runSandbox(spec, "hermes", args, {}, [mount]);
      return;
    }

    // Warn before the dry-run guard: --print-only is how users inspect a launch,
    // so it must show every warning the real launch would print.
    // The user owns config.yaml — warn on mismatch, never rewrite it.
    const expected = "http://localhost:20128/v1";
    if (opts.baseUrl !== expected) {
      console.error(
        `hermes: base URL is ${opts.baseUrl}, but routing comes from the '9router' provider in ~/.hermes/config.yaml. Edit that file yourself if it disagrees.`,
      );
    }

    if (opts.dryRun) {
      console.error("--- hermes dry run ---");
      console.error("args:", args);
      console.error("(hermes routes via the '9router' provider in ~/.hermes/config.yaml)");
      return;
    }

    // ponytail: no api-key warning. --provider 9router means hermes reads its key
    // from its own config, and the empty env below never carries opts.apiKey.
    await runHost("hermes", args, {});
  },
};
