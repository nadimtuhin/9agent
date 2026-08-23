#!/usr/bin/env node
import { Command } from "commander";
import { select, search } from "@inquirer/prompts";
import process from "node:process";
import { createRequire } from "node:module";
import { discoverModels, awaitModels, type ModelEntry } from "./discovery.js";
import { assertModelExists, parseYes, resolveKey } from "./opts.js";
import { runUpdate } from "./update.js";
import { runDoctor, defaultDoctorDeps } from "./doctor.js";
import { REGISTRY, assertSandboxSupported } from "./adapters/base.js";
import { claudeAdapter } from "./adapters/claude.js";
import { piAdapter } from "./adapters/pi.js";
import { hermesAdapter } from "./adapters/hermes.js";
import type { LaunchOptions } from "./adapters/base.js";

REGISTRY.push(claudeAdapter, piAdapter, hermesAdapter);

const program = new Command();

// Read at runtime rather than importing JSON: resolves in both the src/ and
// dist/ layouts, the same way dockerfilePath() does, with no assert syntax.
const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

// Declared before the default action: commander matches a subcommand name
// ahead of the root command's `[args...]`, which would otherwise forward
// `update` to the agent as a passthrough arg.
program
  .command("doctor")
  .description("check the gateway, key, installed agents, and Docker")
  // Repeated here rather than inherited: --gateway/--key sit on the root
  // command, and commander does not pass those down to a subcommand.
  // No default here: an explicit `undefined` is what distinguishes "not passed"
  // from "passed the default", so the root/env fallback below stays reachable
  // whichever command's option set captured the flag.
  .option("--gateway <url>", "9Router base URL")
  .option("--key <token>", "9Router API key [env: NINEROUTER_KEY, LOCAL_9ROUTER_KEY]")
  .action(async (opts: { gateway?: string; key?: string }) => {
    const root = program.opts<{ gateway?: string; key?: string }>();
    const gateway =
      opts.gateway ?? root.gateway ?? process.env.NINEROUTER_URL ?? "http://localhost:20128/v1";
    const keyFlag = opts.key ?? root.key;
    const { report, exitCode } = await runDoctor(
      defaultDoctorDeps({
        gateway,
        key: resolveKey(keyFlag),
        keyFlag,
      }),
    );
    process.stdout.write(report);
    process.exit(exitCode);
  });

program
  .command("update")
  .description("update 9agent to the latest published version")
  .option("--dry-run", "print the npm command, run nothing")
  .action(async (opts: { dryRun?: boolean }) => {
    try {
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
  // No commander default: it would render the resolved value in --help, and
  // that value is a live credential once NINEROUTER_KEY is set. Resolved below.
  .option("--key <token>", "9Router API key [env: NINEROUTER_KEY, LOCAL_9ROUTER_KEY]")
  .option("--yes <mode>", "non-interactive: 'safe' or 'dangerous'")
  .option("--print-only", "print resolved env+args, don't spawn")
  .option("--sandbox", "run the agent in a Docker container")
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
  args: string[];
}

/** An explicit `--model` is validated against the same list the picker offers,
 *  so a typo fails at launch instead of on the agent's first request. */
async function resolveModel(
  flag: string | undefined,
  modelsPromise: Promise<ModelEntry[]>,
): Promise<string> {
  const models = await awaitModels(modelsPromise, {
    stream: process.stderr,
    isTTY: process.stderr.isTTY,
  });

  if (flag) {
    assertModelExists(
      flag,
      models.map((m) => m.id),
    );
    return flag;
  }

  if (!process.stdin.isTTY) {
    throw new Error("No TTY — pass --model <id> to pick a model.");
  }

  return search<string>({
    message: "Pick a model:",
    source: (input) =>
      models
        .filter((m) => m.id.includes(input ?? "") || m.owned_by.includes(input ?? ""))
        .map((m) => ({ name: `${m.id} — ${m.owned_by}`, value: m.id })),
  });
}

async function main(opts: ProgramOpts) {
  const options: ProgramOpts & { key: string } = {
    agent: opts.agent,
    model: opts.model,
    yolo: opts.yolo ?? false,
    gateway: opts.gateway,
    key: resolveKey(opts.key),
    yes: opts.yes,
    printOnly: opts.printOnly ?? false,
    sandbox: opts.sandbox ?? false,
    args: opts.args ?? [],
  };

  // 0. Start the gateway fetch before the agent picker, so its latency hides
  //    inside the time the user spends choosing.
  const modelsPromise = discoverModels(options.gateway, options.key);
  // Between here and the await in resolveModel there is no consumer, and an
  // unhandled rejection is a hard process exit in Node 15+. Mark it handled now;
  // the real await below still rethrows.
  modelsPromise.catch(() => {
    // Intentionally empty: this only marks the rejection handled. resolveModel
    // awaits the same promise and rethrows there, where the message is useful.
  });

  // 1. Pick agent
  let adapter = REGISTRY.find(
    (a) => a.name === options.agent || a.aliases?.includes(options.agent ?? ""),
  );

  if (!adapter && options.agent) {
    throw new Error(
      `Unknown agent '${options.agent}'. Known: ${REGISTRY.map((a) => a.name).join(", ")}.`,
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

  if (options.sandbox) assertSandboxSupported(adapter);

  // 2. Pick model
  const model = await resolveModel(options.model, modelsPromise);

  // 3. Pick mode
  if (options.yolo && options.yes === "safe") {
    throw new Error("--yolo and --yes safe contradict each other; pass one.");
  }
  let yolo = options.yolo;
  if (!yolo && !options.yes && process.stdin.isTTY) {
    const mode = await select({
      message: "Mode:",
      choices: [
        { name: "safe (permissions prompt)", value: false },
        { name: "dangerous (skip permissions)", value: true },
      ],
    });
    yolo = mode;
  } else if (options.yes !== undefined) {
    yolo = parseYes(options.yes);
  }

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

program.parse();
