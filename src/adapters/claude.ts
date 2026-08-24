import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AgentAdapter, LaunchOptions } from "./base.js";
import { runHost } from "../runner/host.js";
import {
  buildSandboxArgs,
  claudeSpec,
  containerizeUrl,
  gitconfigIfPresent,
  readOnlyPathsIn,
  resolveImage,
  runSandbox,
} from "../runner/sandbox.js";

const execFileAsync = promisify(execFile);

export function redactSecrets(env: Record<string, string>): Record<string, string> {
  const safe = { ...env };
  if (safe.ANTHROPIC_AUTH_TOKEN) {
    safe.ANTHROPIC_AUTH_TOKEN = "…redacted";
  }
  return safe;
}

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
  supportsSandbox: true,
  async detect() {
    return new Promise((resolve) => {
      execFileAsync("which", ["claude"])
        .then(() => { resolve(true); })
        .catch(() => { resolve(false); });
    });
  },
  async launch(opts: LaunchOptions) {
    const args = buildClaudeArgs(opts);
    const env = buildClaudeEnv(
      opts.sandbox ? { ...opts, baseUrl: containerizeUrl(opts.baseUrl) } : opts,
    );

    if (opts.dryRun) {
      console.error(`--- claude ${opts.sandbox ? "sandbox " : ""}dry run ---`);
      console.error("env:", JSON.stringify(redactSecrets(env), null, 2));
      if (opts.sandbox) {
        const spec = claudeSpec();
        console.error("image:", resolveImage(spec));
        console.error(
          "docker:",
          buildSandboxArgs({
            image: resolveImage(spec),
            spec,
            bin: "claude",
            args,
            env: redactSecrets(env),
            cwd: process.cwd(),
            tty: process.stdin.isTTY && process.stdout.isTTY,
            gitconfig: gitconfigIfPresent(),
            readOnlyPaths: readOnlyPathsIn(spec.agentHome),
          }).join(" "),
        );
      } else {
        console.error("args:", args);
      }
      return;
    }

    if (opts.sandbox) {
      console.error(`claude: launching sandboxed with model=${opts.model} yolo=${opts.yolo}`);
      await runSandbox(claudeSpec(), "claude", args, env);
      return;
    }

    console.error(`claude: launching with model=${opts.model} yolo=${opts.yolo}`);
    await runHost("claude", args, env);
  },
};
