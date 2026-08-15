import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AgentAdapter, LaunchOptions } from "./base.js";
import { runHost } from "../runner/host.js";

const execFileAsync = promisify(execFile);

export interface ClaudeEnvOpts {
  model: string;
  baseUrl: string;
  apiKey: string;
}

export function buildClaudeEnv(opts: ClaudeEnvOpts): Record<string, string> {
  return {
    ANTHROPIC_BASE_URL: opts.baseUrl,
    ANTHROPIC_AUTH_TOKEN: opts.apiKey,
    ANTHROPIC_DEFAULT_OPUS_MODEL: opts.model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: opts.model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: opts.model,
    CLAUDE_CODE_SUBAGENT_MODEL: opts.model,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
}

export interface ClaudeArgsOpts {
  yolo: boolean;
  extraArgs: string[];
}

export function buildClaudeArgs(opts: ClaudeArgsOpts): string[] {
  return [
    ...(opts.yolo ? ["--dangerously-skip-permissions"] : []),
    ...opts.extraArgs,
  ];
}

export const claudeAdapter: AgentAdapter = {
  name: "claude",
  aliases: ["c", "cc"],
  async detect() {
    return new Promise((resolve) => {
      execFileAsync("which", ["claude"])
        .then(() => resolve(true))
        .catch(() => resolve(false));
    });
  },
  async launch(opts: LaunchOptions) {
    const env = buildClaudeEnv(opts);
    const args = buildClaudeArgs(opts);
    if (opts.dryRun) {
      console.error("--- claude dry run ---");
      console.error("env:", JSON.stringify(env, null, 2));
      console.error("args:", args);
      return;
    }
    console.error(`claude: launching with model=${opts.model} yolo=${opts.yolo}`);
    await runHost("claude", args, env);
  },
};
