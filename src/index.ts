import { Command } from "commander";
import { select, search } from "@inquirer/prompts";
import process from "node:process";
import { createRequire } from "node:module";
import {
  discoverModels,
  awaitModels,
  resolveExplicitModel,
  filterModels,
  type ModelEntry,
} from "./discovery.js";
import { parseYes, resolveKey } from "./opts.js";
import { runUpdate } from "./update.js";
import { checkForUpdate, printUpdateNotice } from "./update-check.js";
import { runDoctor, defaultDoctorDeps } from "./doctor.js";
import { REGISTRY, assertSandboxSupported } from "./adapters/base.js";
import { aiderAdapter } from "./adapters/aider.js";
import { claudeAdapter } from "./adapters/claude.js";
import { clineAdapter } from "./adapters/cline.js";
import { codexAdapter } from "./adapters/codex.js";
import { commandCodeAdapter } from "./adapters/commandcode.js";
import { hermesAdapter } from "./adapters/hermes.js";
import { jcodeAdapter } from "./adapters/jcode.js";
import { kilocodeAdapter } from "./adapters/kilocode.js";
import { opencodeAdapter } from "./adapters/opencode.js";
import { piAdapter } from "./adapters/pi.js";
import type { LaunchOptions } from "./adapters/base.js";

REGISTRY.push(
  aiderAdapter, claudeAdapter, clineAdapter, codexAdapter,
  commandCodeAdapter, hermesAdapter, jcodeAdapter, kilocodeAdapter,
  opencodeAdapter, piAdapter,
);

const program = new Command();

const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

program
  .command("doctor")
  .description("check the gateway, key, installed agents, and Docker")
  .option("--gateway <url>", "9Router base URL")
  .option("--key <token>", "9Router API key [env: NINEROUTER_KEY, LOCAL_9ROUTER_KEY]")
  .option("--json", "machine-readable output for CI")
  .action(async (opts: { gateway?: string; key?: string; json?: boolean }) => {
    const root = program.opts<{ gateway?: string; key?: string }>();
    const gateway =
      opts.gateway ?? root.gateway ?? process.env.NINEROUTER_URL ?? "http://localhost:20128/v1";
    const keyFlag = opts.key ?? root.key;
    const { checks, report, exitCode } = await runDoctor(
      defaultDoctorDeps({
        gateway,
        key: resolveKey(keyFlag),
        keyFlag,
      }),
    );
    process.stdout.write(
      opts.json ? JSON.stringify({ ok: exitCode === 0, checks }, null, 2) + "\n" : report,
    );
    process.exit(exitCode);
  });

program
  .command("models")
  .description("list the models the gateway serves")
  .option("--gateway <url>", "9Router base URL")
  .option("--key <token>", "9Router API key [env: NINEROUTER_KEY, LOCAL_9ROUTER_KEY]")
  .option("--json", "machine-readable output")
  .action(async (opts: { gateway?: string; key?: string; json?: boolean }) => {
    const root = program.opts<{ gateway?: string; key?: string }>();
    const gateway =
      opts.gateway ?? root.gateway ?? process.env.NINEROUTER_URL ?? "http://localhost:20128/v1";
    try {
      const models = await discoverModels(gateway, resolveKey(opts.key ?? root.key));
      process.stdout.write(
        opts.json
          ? JSON.stringify(models, null, 2) + "\n"
          : models.map((m) => `${m.id}\t${m.owned_by}`).join("\n") + "\n",
      );
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command("update")
  .description("update 9agent to the latest published version")
  .option("--dry-run", "print the npm command, run nothing")
  .option("--force", "update even if already on the latest version")
  .action(async (opts: { dryRun?: boolean; force?: boolean }) => {
    try {
      if (!opts.force) {
        const check = await checkForUpdate(pkg.version, { skipCache: true });
        if (!check.updateAvailable) {
          console.log(`Already on the latest version (${pkg.version}).`);
          return;
        }
        console.log(`Updating ${check.current} → ${check.latest}...`);
      }
      console.log(await runUpdate({ dryRun: opts.dryRun }));
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .name("9agent")
  .description("Universal 9Router agent launcher")
  .version(pkg.version)
  .option("-a, --agent <name>", "agent name or alias")
  .option("-m, --model <id>", "model ID (skip picker)")
  .option("--yolo", "skip permissions / dangerous mode")
  .option("--gateway <url>", "9Router base URL", process.env.NINEROUTER_URL ?? "http://localhost:20128/v1")
  .option("--key <token>", "9Router API key [env: NINEROUTER_KEY, LOCAL_9ROUTER_KEY]")
  .option("--yes <mode>", "non-interactive: 'safe' or 'dangerous'")
  .option("--print-only", "print resolved env+args, don't spawn")
  .option("--sandbox", "run the agent in a Docker container")
  .option("--no-update", "skip the startup version check")
  .argument("[args...]", "extra args passed through to the agent")
  .action(async (args: string[], opts: Omit<ProgramOpts, "args">) => {
    try {
      await main({ ...opts, args });
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

interface ProgramOpts {
  agent?: string;
  model?: string;
  yolo: boolean;
  gateway: string;
  key?: string;
  yes?: string;
  printOnly: boolean;
  sandbox: boolean;
  update: boolean;
  args: string[];
}

async function resolveModel(
  flag: string | undefined,
  modelsPromise: Promise<ModelEntry[]>,
): Promise<string> {
  if (flag) {
    const { model, warning } = await resolveExplicitModel(
      flag,
      modelsPromise,
      process.stderr,
    );
    if (warning) console.error(warning);
    return model;
  }

  const models = await awaitModels(modelsPromise, {
    stream: process.stderr,
    isTTY: process.stderr.isTTY,
  });

  if (!process.stdin.isTTY) {
    throw new Error("No TTY — pass --model <id> to pick a model.");
  }

  return search<string>({
    message: "Pick a model:",
    source: (input) =>
      filterModels(models, input ?? "").map((m) => ({
        name: `${m.id} — ${m.owned_by}`,
        value: m.id,
      })),
  });
}

async function main(opts: ProgramOpts) {
  if (opts.update) {
    checkForUpdate(pkg.version).then(printUpdateNotice).catch(() => void 0);
  }

  const options: ProgramOpts & { key: string } = {
    ...opts,
    key: resolveKey(opts.key),
    yolo: opts.yolo ?? false,
    printOnly: opts.printOnly ?? false,
    sandbox: opts.sandbox ?? false,
    update: opts.update ?? true,
  };

  const modelsPromise = discoverModels(options.gateway, options.key);
  modelsPromise.catch((_e: unknown) => { void _e; });

  const adapter = await resolveAdapter(options.agent);

  if (options.sandbox) assertSandboxSupported(adapter);

  const model = options.printOnly && options.model
    ? options.model
    : await resolveModel(options.model, modelsPromise);

  const yolo = await resolveYolo(options);

  const launchOpts: LaunchOptions = {
    model: model,
    baseUrl: options.gateway,
    apiKey: options.key,
    yolo,
    extraArgs: options.args,
    dryRun: options.printOnly,
    sandbox: options.sandbox,
  };
  await adapter.launch(launchOpts);
}

async function filterInstalled(adapters: typeof REGISTRY) {
  const result = [];
  for (const a of adapters) {
    if (await a.detect()) result.push(a);
  }
  return result;
}

async function resolveAdapter(agentName?: string) {
  let adapter = REGISTRY.find(
    (a) => a.name === agentName || a.aliases?.includes(agentName ?? ""),
  );

  if (!adapter && agentName) {
    throw new Error(
      `Unknown agent '${agentName}'. Known: ${REGISTRY.map((a) => a.name).join(", ")}.`,
    );
  }

  if (!adapter) {
    const installed = await filterInstalled(REGISTRY);
    if (installed.length === 0) {
      console.error("No installed agents found. Install claude or pi first.");
      process.exit(1);
    }
    if (!process.stdin.isTTY) {
      throw new Error("No TTY — pass --agent <name> to pick an agent.");
    }
    const answer = await select({
      message: "Pick an agent:",
      choices: installed.map((a) => ({
        name: a.name,
        value: a,
        description: a.aliases?.length ? `aliases: ${a.aliases.join(", ")}` : undefined,
      })),
    });
    adapter = answer;
  }

  return adapter;
}

async function resolveYolo(opts: ProgramOpts & { key: string }) {
  if (opts.yolo && opts.yes === "safe") {
    throw new Error("--yolo and --yes safe contradict each other; pass one.");
  }
  if (opts.yolo) return true;
  if (opts.yes !== undefined) return parseYes(opts.yes);
  if (process.stdin.isTTY) {
    const mode = await select({
      message: "Mode:",
      choices: [
        { name: "safe (permissions prompt)", value: false },
        { name: "dangerous (skip permissions)", value: true },
      ],
    });
    return mode;
  }
  return false;
}

program.parse();
