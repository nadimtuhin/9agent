import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AgentAdapter, LaunchOptions } from "./base.js";
import { runHost } from "../runner/host.js";
import { clineSpec, containerizeUrl, resolveImage, runSandbox } from "../runner/sandbox.js";

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
  supportsSandbox: true,
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

    if (opts.sandbox) {
      const spec = clineSpec();
      const env = {
        OPENAI_BASE_URL: containerizeUrl(opts.baseUrl),
        OPENAI_API_KEY: opts.apiKey,
      };
      if (opts.dryRun) {
        console.error("--- cline sandbox dry run ---");
        console.error("image:", resolveImage(spec));
        console.error("env: OPENAI_BASE_URL=" + env.OPENAI_BASE_URL);
        console.error("env: OPENAI_API_KEY=<redacted>");
        return;
      }
      console.error(`cline: launching sandboxed with model=${opts.model}`);
      await runSandbox(spec, "cline", args, env);
      return;
    }

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
