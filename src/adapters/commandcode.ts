import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { AgentAdapter, LaunchOptions } from "./base.js";
import { runHost } from "../runner/host.js";
import {
  commandCodeSpec,
  containerizeUrl,
  resolveImage,
  runSandbox,
  shadowConfigDir,
} from "../runner/sandbox.js";

const execFileAsync = promisify(execFile);

export function buildCommandCodeEnv(opts: {
  baseUrl: string;
  apiKey: string;
}): Record<string, string> {
  return {
    ANTHROPIC_BASE_URL: opts.baseUrl,
    ANTHROPIC_AUTH_TOKEN: opts.apiKey,
  };
}

export function buildCommandCodeArgs(opts: {
  model: string;
  yolo: boolean;
  extraArgs: string[];
}): string[] {
  return [
    "-m",
    opts.model,
    ...(opts.yolo ? ["--yolo"] : []),
    ...opts.extraArgs,
  ];
}

export function writeCommandCodeShadow(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
}): string {
  const dir = shadowConfigDir("command-code");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const shadow = join(dir, "providers.json");
  writeFileSync(
    shadow,
    JSON.stringify({
      provider: {
        "9router": {
          name: "9Router",
          baseURL: containerizeUrl(opts.baseUrl),
          apiKey: "$NINEROUTER_KEY",
          models: {
            [opts.model]: {},
          },
        },
      },
    }),
    { encoding: "utf-8", mode: 0o600 },
  );
  return shadow;
}

export const commandCodeAdapter: AgentAdapter = {
  name: "command-code",
  aliases: ["cmd"],
  supportsSandbox: true,
  async detect() {
    try {
      await execFileAsync("which", ["cmd"]);
      return true;
    } catch {
      return false;
    }
  },
  async launch(opts: LaunchOptions) {
    const args = buildCommandCodeArgs(opts);

    if (opts.sandbox) {
      const spec = commandCodeSpec();
      const shadow = writeCommandCodeShadow({
        baseUrl: opts.baseUrl,
        apiKey: opts.apiKey,
        model: opts.model,
      });
      const mount = `${shadow}:/home/node/.commandcode/providers.json:ro`;
      const env: Record<string, string> = {
        NINEROUTER_KEY: opts.apiKey,
      };

      if (opts.dryRun) {
        console.error("--- command-code sandbox dry run ---");
        console.error("image:", resolveImage(spec));
        console.error("shadow config:", shadow);
        console.error("gateway:", containerizeUrl(opts.baseUrl), "(key not shown)");
        console.error("args:", args);
        return;
      }
      console.error(`command-code: launching sandboxed with model=${opts.model}`);
      await runSandbox(spec, "cmd", args, env, [mount]);
      return;
    }

    const env = buildCommandCodeEnv(opts);

    if (opts.dryRun) {
      console.error("--- command-code dry run ---");
      console.error("args:", args);
      console.error("env: ANTHROPIC_BASE_URL=" + env.ANTHROPIC_BASE_URL);
      console.error("env: ANTHROPIC_AUTH_TOKEN=<redacted>");
      return;
    }

    console.error(`command-code: launching with model=${opts.model} yolo=${opts.yolo}`);
    await runHost("cmd", args, env);
  },
};
