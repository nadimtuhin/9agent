import { Command } from "commander";
import { select, search } from "@inquirer/prompts";
import process from "node:process";
import { createRequire } from "node:module";
import { discoverModels, awaitModels, filterModels, type ModelEntry } from "./discovery.js";
import { applyLastOpts, assertModelExists, parseYes, resolveKey, resolveModelFuzzy } from "./opts.js";
import { checkForUpdate, printUpdateNotice } from "./update-check.js";
import { registerCommands } from "./commands.js";
import { registerGatewayCommands } from "./gateway.js";
import { registerKeyPrompt } from "./key-prompt.js";
import {
  savedKey,
  getLastGateway, setLastGateway,
  getLastModels, setLastModels,
  getLastAgent, setLastAgent,
} from "./profiles.js";
import { REGISTRY, assertSandboxSupported } from "./adapters/base.js";
import { ALL_ADAPTERS } from "./adapters/index.js";
import type { LaunchOptions } from "./adapters/base.js";

REGISTRY.push(...ALL_ADAPTERS);

const program = new Command();

const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

registerCommands(program, pkg);
registerGatewayCommands(program);
registerKeyPrompt(program);

program
  .name("9agent")
  .description("Universal 9Router agent launcher")
  .version(pkg.version)
  .option("-a, --agent <name>", "agent name or alias")
  .option("-m, --model <ids>", "model ID(s), comma-separated (skip picker)")
  .option("-l, --last", "launch with last-used agent, model, and gateway")
  .option("--yolo", "skip permissions / dangerous mode")
  .option("--gateway <url>", "9Router base URL")
  .option("--key", "prompt for this gateway's key and save it to its profile")
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
  models?: string[];
  last?: boolean;
  yolo: boolean;
  gateway: string;
  key?: boolean;
  yes?: string;
  printOnly: boolean;
  sandbox: boolean;
  update: boolean;
  args: string[];
}

async function resolveModels(
  flag: string | undefined,
  modelsPromise: Promise<ModelEntry[]>,
  gateway: string,
): Promise<{ models: string[]; contextWindow?: number }> {
  if (flag) {
    const ids = flag.split(",").map((s) => s.trim()).filter(Boolean);
    const models = await awaitModels(modelsPromise, { stream: process.stderr, isTTY: false });
    const allIds = models.map((m) => m.id);
    for (const id of ids) {
      if (allIds.includes(id)) continue;
      const fuzzy = resolveModelFuzzy(id, allIds);
      if (fuzzy) {
        console.error(`9agent: '${id}' resolved to '${fuzzy}'`);
        ids[ids.indexOf(id)] = fuzzy;
      } else {
        assertModelExists(id, allIds);
      }
    }
    const entry = models.find((m) => m.id === ids[0]);
    return { models: ids, contextWindow: entry?.context_window };
  }

  const models = await awaitModels(modelsPromise, {
    stream: process.stderr,
    isTTY: process.stderr.isTTY,
  });

  if (!process.stdin.isTTY) {
    throw new Error("No TTY — pass --model <ids> to pick models.");
  }

  const last = getLastModels(gateway) ?? [];
  const sorted = [...models];
  if (last.length > 0) {
    sorted.sort((a, b) => {
      const aIdx = last.indexOf(a.id);
      const bIdx = last.indexOf(b.id);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return 0;
    });
  }

  const picked = await search<string>({
    message: "Pick a model:",
    source: (input) =>
      filterModels(sorted, input ?? "").map((m) => ({
        name: `${m.id} — ${m.owned_by}`,
        value: m.id,
      })),
  });

  setLastModels(gateway, [picked]);
  const entry = models.find((m) => m.id === picked);
  return { models: [picked], contextWindow: entry?.context_window };
}

async function main(opts: ProgramOpts) {
  if (opts.update) {
    checkForUpdate(pkg.version).then(printUpdateNotice).catch(() => void 0);
  }

  const gateway = opts.gateway ?? process.env.NINEROUTER_URL ?? getLastGateway() ?? "http://localhost:20128/v1";
  setLastGateway(gateway);
  applyLastOpts(opts, gateway);

  const options: Omit<ProgramOpts, "key"> & { key: string } = {
    ...opts,
    gateway,
    key: resolveKey(savedKey(gateway)),
    yolo: opts.yolo ?? false,
    printOnly: opts.printOnly ?? false,
    sandbox: opts.sandbox ?? false,
    update: opts.update ?? true,
  };

  const modelsPromise = discoverModels(options.gateway, options.key);
  modelsPromise.catch((_e: unknown) => { void _e; });

  const adapter = await resolveAdapter(options.agent);
  setLastAgent(adapter.name);

  if (options.sandbox) assertSandboxSupported(adapter);

  const { models, contextWindow } = options.printOnly && options.model
    ? { models: options.model.split(",").map(s => s.trim()).filter(Boolean) }
    : await resolveModels(options.model, modelsPromise, options.gateway);
  const yolo = await resolveYolo(options);

  const launchOpts: LaunchOptions = {
    model: models[0],
    models,
    contextWindow,
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
  const detected = await Promise.all(
    adapters.map(async (a) => ((await a.detect()) ? a : null)),
  );
  return detected.filter((a): a is (typeof adapters)[number] => a !== null);
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
    const last = getLastAgent();
    const defaultVal = installed.find((a) => a.name === last || a.aliases?.includes(last ?? ""));
    const answer = await select({
      message: "Pick an agent:",
      choices: installed.map((a) => ({
        name: a.name,
        value: a,
        description: a.aliases?.length ? `aliases: ${a.aliases.join(", ")}` : undefined,
      })),
      default: defaultVal,
    });
    adapter = answer;
  }

  return adapter;
}

async function resolveYolo(opts: Omit<ProgramOpts, "key"> & { key: string }) {
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

await program.parseAsync();
