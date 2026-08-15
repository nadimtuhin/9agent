#!/usr/bin/env node
import { Command } from "commander";
import { select, search } from "@inquirer/prompts";
import process from "node:process";
import { discoverModels } from "./discovery.js";
import { REGISTRY } from "./adapters/base.js";
import { claudeAdapter } from "./adapters/claude.js";
import { piAdapter } from "./adapters/pi.js";
import { hermesAdapter } from "./adapters/hermes.js";
import type { LaunchOptions } from "./adapters/base.js";

REGISTRY.push(claudeAdapter, piAdapter, hermesAdapter);

const program = new Command();

program
  .name("9agent")
  .description("Universal 9Router agent launcher")
  .option("-a, --agent <name>", "agent name or alias")
  .option("-m, --model <id>", "model ID (skip picker)")
  .option("--yolo", "skip permissions / dangerous mode")
  .option("--gateway <url>", "9Router base URL", process.env.NINEROUTER_URL ?? "http://localhost:20128/v1")
  .option("--key <token>", "9Router API key", process.env.NINEROUTER_KEY ?? "sk_9router")
  .option("--yes <mode>", "non-interactive: 'safe' or 'dangerous'")
  .option("--print-only", "print resolved env+args, don't spawn")
  .action(async (opts) => {
    await main(opts);
  });

interface ProgramOpts {
  agent?: string;
  model?: string;
  yolo: boolean;
  gateway: string;
  key: string;
  yes?: string;
  printOnly: boolean;
  args: string[];
}

async function main(opts: any) {
  const options: ProgramOpts = {
    agent: opts.agent,
    model: opts.model,
    yolo: opts.yolo ?? false,
    gateway: opts.gateway,
    key: opts.key,
    yes: opts.yes,
    printOnly: opts.printOnly ?? false,
    args: opts.args ?? [],
  };

  // 1. Pick agent
  let adapter = REGISTRY.find(
    (a) => a.name === options.agent || a.aliases?.includes(options.agent ?? ""),
  );

  if (!adapter) {
    const installed = await filterInstalled(REGISTRY);
    if (installed.length === 0) {
      console.error("No installed agents found. Install claude or pi first.");
      process.exit(1);
    }
    const answer = await select({
      message: "Pick an agent:",
      choices: installed.map((a) => ({
        name: `${a.name}`,
        value: a,
        description: a.aliases?.length ? `aliases: ${a.aliases.join(", ")}` : undefined,
      })),
      default: "claude",
    });
    adapter = answer;
  }

  // 2. Pick model
  const models = await discoverModels(options.gateway, options.key);
  let model = options.model;
  if (!model) {
    const answer = await search<string>({
      message: "Pick a model:",
      source: async (input, _choices) => {
        const filtered = models.filter(
          (m) =>
            m.id.includes(input ?? "") ||
            m.owned_by.includes(input ?? ""),
        );
        return filtered.map((m) => ({
          name: `${m.id} — ${m.owned_by}`,
          value: m.id,
        }));
      },
    });
    model = answer;
  }

  // 3. Pick mode
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
  } else if (options.yes === "dangerous") {
    yolo = true;
  } else if (options.yes === "safe") {
    yolo = false;
  }

  const launchOpts: LaunchOptions = {
    model: model!,
    baseUrl: options.gateway,
    apiKey: options.key,
    yolo,
    extraArgs: options.args,
    dryRun: options.printOnly,
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
