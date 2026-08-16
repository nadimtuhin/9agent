import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AgentAdapter, LaunchOptions } from "./base.js";
import { runHost } from "../runner/host.js";

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
