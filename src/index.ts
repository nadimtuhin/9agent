import { Command } from "commander";
import { checkbox, password, select, search } from "@inquirer/prompts";
import process from "node:process";
import { createRequire } from "node:module";
import {
  discoverModels, awaitModels, resolveExplicitModel, filterModels, type ModelEntry,
} from "./discovery.js";
import { assertModelExists, parseYes, resolveKey } from "./opts.js";
import { checkForUpdate, printUpdateNotice } from "./update-check.js";
import { registerCommands } from "./commands.js";
import { saveKey, savedKey, getLastGateway, setLastGateway, getLastModels, setLastModels } from "./profiles.js";
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
  aiderAdapter, claudeAdapter, clineAdapter, codexAdapter, commandCodeAdapter,
  hermesAdapter, jcodeAdapter, kilocodeAdapter, opencodeAdapter, piAdapter,
);

const program = new Command();

const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

registerCommands(program, pkg);

program
  .name("9agent")
  .description("Universal 9Router agent launcher")
  .version(pkg.version)
  .option("-a, --agent <name>", "agent name or alias")
  .option("-m, --model <ids>", "model ID(s), comma-separated (skip picker)")
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
): Promise<{ models: string[]; contextWindow?: number }> {
  if (flag) {
    const ids = flag.split(",").map((s) => s.trim()).filter(Boolean);
    const models = await awaitModels(modelsPromise, { stream: process.stderr, isTTY: false });
    for (const id of ids) assertModelExists(id, models.map((m) => m.id));
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

  const last = getLastModels() ?? [];
  const choices = models.map((m) => ({
    name: `${m.id} — ${m.owned_by}`,
    value: m.id,
    checked: last.includes(m.id),
  }));

  if (choices.every((c) => !c.checked) && last.length > 0 && choices.length > 0) {
    choices[0].checked = true;
  }

  const picked = await checkbox<string>({
    message: "Pick models (space to select, enter to confirm):",
    choices,
    validate: (sel) => sel.length > 0 || "Pick at least one model.",
  });

  setLastModels(picked);
  const entry = models.find((m) => m.id === picked[0]);
  return { models: picked, contextWindow: entry?.context_window };
}

async function main(opts: ProgramOpts) {
  if (opts.update) {
    checkForUpdate(pkg.version).then(printUpdateNotice).catch(() => void 0);
  }

  const gateway = opts.gateway ?? process.env.NINEROUTER_URL ?? getLastGateway() ?? "http://localhost:20128/v1";
  setLastGateway(gateway);

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

  if (options.sandbox) assertSandboxSupported(adapter);

  const { models, contextWindow } = options.printOnly && options.model
    ? { models: options.model.split(",").map(s => s.trim()).filter(Boolean) }
    : await resolveModels(options.model, modelsPromise);
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

function inlineKeyError(gateway: string): Error {
  return new Error(
    "--key no longer takes a value: inline keys land in shell history and get mangled by shell quoting.\n" +
      `Run \`9agent --gateway ${gateway} --key\` and paste the key at the prompt.`,
  );
}

function isSubcommand(word: string): boolean {
  return word === "help" || program.commands.some((c) => c.name() === word || c.aliases().includes(word));
}

async function promptForKey() {
  const { key } = program.opts<{ key?: boolean }>();
  if (!key) return;
  const gateway = program.opts<{ gateway?: string }>().gateway ?? process.env.NINEROUTER_URL ?? getLastGateway() ?? "http://localhost:20128/v1";
  const next = process.argv[process.argv.indexOf("--key") + 1];
  if (next !== undefined && !next.startsWith("-") && !isSubcommand(next)) {
    throw inlineKeyError(gateway);
  }
  if (!process.stdin.isTTY) {
    throw new Error("--key needs a terminal to prompt. For non-interactive runs set NINEROUTER_KEY.");
  }
  const entered = (await password({ message: `Key for ${gateway}:`, mask: "*" })).trim();
  if (!entered) throw new Error("No key entered; nothing saved.");
  saveKey(gateway, entered);
  console.error(`9agent: saved key for ${gateway}.`);
}

program.hook("preAction", async () => {
  try {
    await promptForKey();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
});

if (process.argv.some((a) => a.startsWith("--key="))) {
  console.error(inlineKeyError("<url>").message);
  process.exit(1);
}

await program.parseAsync();
