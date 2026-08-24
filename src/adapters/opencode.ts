import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { AgentAdapter, LaunchOptions } from "./base.js";
import { runHost } from "../runner/host.js";
import {
  containerizeUrl,
  opencodeSpec,
  resolveImage,
  runSandbox,
  shadowConfigDir,
} from "../runner/sandbox.js";

const execFileAsync = promisify(execFile);

export function buildOpenCodeArgs(opts: {
  model: string;
  yolo: boolean;
  extraArgs: string[];
}): string[] {
  return [
    "run",
    "--model",
    `9router/${opts.model}`,
    ...(opts.yolo ? ["--dangerously-skip-permissions"] : []),
    ...opts.extraArgs,
  ];
}

export function buildOpenCodeConfig(opts: {
  baseURL: string;
  apiKey: string;
  model: string;
}): string {
  return JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    provider: {
      "9router": {
        npm: "@ai-sdk/openai-compatible",
        name: "9Router",
        options: {
          baseURL: opts.baseURL,
          apiKey: opts.apiKey,
        },
        models: {
          [opts.model]: {},
        },
      },
    },
  });
}

const CONFIG_MOUNT_TARGET = "/run/9agent/opencode.json";

export function writeOpenCodeShadow(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
}): string {
  const dir = shadowConfigDir("opencode");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const shadow = join(dir, "opencode.json");
  writeFileSync(
    shadow,
    buildOpenCodeConfig({
      baseURL: containerizeUrl(opts.baseUrl),
      apiKey: opts.apiKey,
      model: opts.model,
    }),
    { encoding: "utf-8", mode: 0o600 },
  );
  return shadow;
}

function writeHostOpencodeConfig(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
}): string {
  const dir = shadowConfigDir("opencode");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const shadow = join(dir, "opencode-host.json");
  writeFileSync(
    shadow,
    buildOpenCodeConfig({ baseURL: opts.baseUrl, apiKey: opts.apiKey, model: opts.model }),
    { encoding: "utf-8", mode: 0o600 },
  );
  return shadow;
}

export const opencodeAdapter: AgentAdapter = {
  name: "opencode",
  aliases: ["oc", "op"],
  supportsSandbox: true,
  async detect() {
    try {
      await execFileAsync("which", ["opencode"]);
      return true;
    } catch {
      return false;
    }
  },
  async launch(opts: LaunchOptions) {
    const args = buildOpenCodeArgs(opts);

    if (opts.sandbox) {
      const spec = opencodeSpec();
      const shadow = writeOpenCodeShadow({
        baseUrl: opts.baseUrl,
        apiKey: opts.apiKey,
        model: opts.model,
      });
      const mount = `${shadow}:${CONFIG_MOUNT_TARGET}:ro`;
      const env: Record<string, string> = {
        OPENCODE_CONFIG: CONFIG_MOUNT_TARGET,
      };

      if (opts.dryRun) {
        console.error("--- opencode sandbox dry run ---");
        console.error("image:", resolveImage(spec));
        console.error("shadow config:", shadow);
        console.error("gateway:", containerizeUrl(opts.baseUrl), "(key not shown)");
        console.error("args:", args);
        return;
      }
      console.error(`opencode: launching sandboxed with model=${opts.model}`);
      await runSandbox(spec, "opencode", args, env, [mount]);
      return;
    }

    await launchOnHost(opts, args);
  },
};

async function launchOnHost(
  opts: LaunchOptions,
  args: string[],
): Promise<void> {
  const shadow = writeHostOpencodeConfig({
    baseUrl: opts.baseUrl,
    apiKey: opts.apiKey,
    model: opts.model,
  });
  if (opts.dryRun) {
    console.error("--- opencode dry run ---");
    console.error("args:", args);
    console.error("config:", shadow);
    return;
  }
  await runHost("opencode", args, { OPENCODE_CONFIG: shadow });
}
