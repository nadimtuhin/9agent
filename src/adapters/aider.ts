import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AgentAdapter, LaunchOptions } from "./base.js";
import { runHost } from "../runner/host.js";

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
  supportsSandbox: false,
  sandboxRefusal:
    "aider: --sandbox is not supported — aider is an external CLI. Run it on the host.",
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
