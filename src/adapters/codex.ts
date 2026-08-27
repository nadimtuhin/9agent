import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AgentAdapter, LaunchOptions } from "./base.js";
import { runHost } from "../runner/host.js";

const execFileAsync = promisify(execFile);

export function buildCodexArgs(opts: {
  model: string;
  baseUrl?: string;
  yolo: boolean;
  extraArgs: string[];
}): string[] {
  const base = opts.baseUrl ?? "http://localhost:20128/v1";
  return [
    "-c",
    'model_provider="9router"',
    "-c",
    'model_providers.9router.name="9Router"',
    "-c",
    `model_providers.9router.base_url="${base}"`,
    "-c",
    'model_providers.9router.env_key="OPENAI_API_KEY"',
    "-c",
    'model_providers.9router.wire_api="responses"',
    "--model",
    opts.model,
    ...(opts.yolo ? ["--dangerously-bypass-approvals-and-sandbox"] : []),
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
    const args = buildCodexArgs({
      model: opts.model,
      baseUrl: opts.baseUrl,
      yolo: opts.yolo,
      extraArgs: opts.extraArgs,
    });

    if (opts.dryRun) {
      console.error("--- codex dry run ---");
      console.error("args:", args);
      console.error("env: OPENAI_API_KEY=<redacted>");
      return;
    }

    await runHost("codex", args, {
      OPENAI_API_KEY: opts.apiKey,
    });
  },
};
