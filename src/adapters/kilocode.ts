import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AgentAdapter, LaunchOptions } from "./base.js";
import { runHost } from "../runner/host.js";
import { kilocodeSpec, containerizeUrl, resolveImage, runSandbox } from "../runner/sandbox.js";

const execFileAsync = promisify(execFile);

export function buildKilocodeArgs(opts: {
  model: string;
  yolo: boolean;
  extraArgs: string[];
}): string[] {
  return [
    "run",
    "--model",
    opts.model,
    ...(opts.yolo ? ["--dangerously-skip-permissions"] : []),
    ...opts.extraArgs,
  ];
}

export const kilocodeAdapter: AgentAdapter = {
  name: "kilocode",
  aliases: ["kc", "kilo"],
  supportsSandbox: false,
  sandboxRefusal:
    "kilocode: --sandbox is not supported — kilocode is an external CLI. Run it on the host.",
  async detect() {
    try {
      await execFileAsync("which", ["kilocode"]);
      return true;
    } catch {
      return false;
    }
  },
  async launch(opts: LaunchOptions) {
    const args = buildKilocodeArgs(opts);

    if (opts.sandbox) {
      const spec = kilocodeSpec();
      const env = {
        OPENAI_BASE_URL: containerizeUrl(opts.baseUrl),
        OPENAI_API_KEY: opts.apiKey,
      };
      if (opts.dryRun) {
        console.error("--- kilocode sandbox dry run ---");
        console.error("image:", resolveImage(spec));
        console.error("env: OPENAI_BASE_URL=" + env.OPENAI_BASE_URL);
        console.error("env: OPENAI_API_KEY=<redacted>");
        return;
      }
      console.error(`kilocode: launching sandboxed with model=${opts.model}`);
      await runSandbox(spec, "kilocode", args, env);
      return;
    }

    if (opts.dryRun) {
      console.error("--- kilocode dry run ---");
      console.error("args:", args);
      console.error("env: OPENAI_BASE_URL=" + opts.baseUrl);
      console.error("env: OPENAI_API_KEY=<redacted>");
      return;
    }

    await runHost("kilocode", args, {
      OPENAI_BASE_URL: opts.baseUrl,
      OPENAI_API_KEY: opts.apiKey,
    });
  },
};
