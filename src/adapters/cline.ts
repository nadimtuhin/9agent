import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AgentAdapter, LaunchOptions } from "./base.js";
import { runHost } from "../runner/host.js";

const execFileAsync = promisify(execFile);

export function buildClineArgs(opts: {
  model: string;
  yolo: boolean;
  extraArgs: string[];
}): string[] {
  return [
    "--model",
    opts.model,
    ...(opts.yolo ? ["--auto-approve"] : []),
    ...opts.extraArgs,
  ];
}

export const clineAdapter: AgentAdapter = {
  name: "cline",
  aliases: ["cl"],
  supportsSandbox: false,
  sandboxRefusal:
    "cline: --sandbox is not supported — cline is an external CLI. Run it on the host.",
  async detect() {
    try {
      await execFileAsync("which", ["cline"]);
      return true;
    } catch {
      return false;
    }
  },
  async launch(opts: LaunchOptions) {
    const args = buildClineArgs(opts);

    if (opts.dryRun) {
      console.error("--- cline dry run ---");
      console.error("args:", args);
      console.error("env: OPENAI_BASE_URL=" + opts.baseUrl);
      console.error("env: OPENAI_API_KEY=<redacted>");
      return;
    }

    await runHost("cline", args, {
      OPENAI_BASE_URL: opts.baseUrl,
      OPENAI_API_KEY: opts.apiKey,
    });
  },
};
