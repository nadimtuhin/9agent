import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AgentAdapter, LaunchOptions } from "./base.js";
import { runHost } from "../runner/host.js";
import { aiderSpec, containerizeUrl, resolveImage, runSandbox } from "../runner/sandbox.js";

const execFileAsync = promisify(execFile);

export function buildAiderArgs(opts: {
  model: string;
  yolo: boolean;
  extraArgs: string[];
}): string[] {
  return [
    "--model",
    `openai/${opts.model}`,
    ...(opts.yolo ? ["--yes-always"] : []),
    ...opts.extraArgs,
  ];
}

export const aiderAdapter: AgentAdapter = {
  name: "aider",
  aliases: ["a"],
  supportsSandbox: true,
  async detect() {
    try {
      await execFileAsync("which", ["aider"]);
      return true;
    } catch {
      return false;
    }
  },
  async launch(opts: LaunchOptions) {
    const args = buildAiderArgs(opts);

    if (opts.sandbox) {
      const spec = aiderSpec();
      const env = {
        OPENAI_API_BASE: containerizeUrl(opts.baseUrl),
        OPENAI_API_KEY: opts.apiKey,
      };
      if (opts.dryRun) {
        console.error("--- aider sandbox dry run ---");
        console.error("image:", resolveImage(spec));
        console.error("env: OPENAI_API_BASE=" + env.OPENAI_API_BASE);
        console.error("env: OPENAI_API_KEY=<redacted>");
        return;
      }
      console.error(`aider: launching sandboxed with model=${opts.model}`);
      await runSandbox(spec, "aider", args, env);
      return;
    }

    if (opts.dryRun) {
      console.error("--- aider dry run ---");
      console.error("args:", args);
      console.error("env: OPENAI_API_BASE=" + opts.baseUrl);
      console.error("env: OPENAI_API_KEY=<redacted>");
      return;
    }

    await runHost("aider", args, {
      OPENAI_API_BASE: opts.baseUrl,
      OPENAI_API_KEY: opts.apiKey,
    });
  },
};
