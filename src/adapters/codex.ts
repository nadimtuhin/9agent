import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AgentAdapter, LaunchOptions } from "./base.js";
import { runHost } from "../runner/host.js";

const execFileAsync = promisify(execFile);

export function buildCodexArgs(opts: {
  model: string;
  yolo: boolean;
  extraArgs: string[];
}): string[] {
  return [
    "--model",
    opts.model,
    ...(opts.yolo ? ["--full-auto"] : []),
    ...opts.extraArgs,
  ];
}

export const codexAdapter: AgentAdapter = {
  name: "codex",
  aliases: ["cx"],
  supportsSandbox: false,
  sandboxRefusal:
    "codex: --sandbox is not supported — codex is an external CLI. Run it on the host.",
  async detect() {
    try {
      await execFileAsync("which", ["codex"]);
      return true;
    } catch {
      return false;
    }
  },
  async launch(opts: LaunchOptions) {
    const args = buildCodexArgs(opts);

    if (opts.dryRun) {
      console.error("--- codex dry run ---");
      console.error("args:", args);
      console.error("env: OPENAI_BASE_URL=" + opts.baseUrl);
      console.error("env: OPENAI_API_KEY=<redacted>");
      return;
    }

    await runHost("codex", args, {
      OPENAI_BASE_URL: opts.baseUrl,
      OPENAI_API_KEY: opts.apiKey,
    });
  },
};
