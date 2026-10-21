import { Command } from "commander";
import { password } from "@inquirer/prompts";
import process from "node:process";
import { getLastGateway, saveKey } from "./profiles.js";

export function inlineKeyError(gateway: string): Error {
  return new Error(
    "--key no longer takes a value: inline keys land in shell history and get mangled by shell quoting.\n" +
      `Run \`9agent --gateway ${gateway} --key\` and paste the key at the prompt.`,
  );
}

function isSubcommand(program: Command, word: string): boolean {
  return word === "help" || program.commands.some((c) => c.name() === word || c.aliases().includes(word));
}

export async function promptForKey(program: Command): Promise<void> {
  const { key } = program.opts<{ key?: boolean }>();
  if (!key) return;
  const gateway = program.opts<{ gateway?: string }>().gateway ?? process.env.NINEROUTER_URL ?? getLastGateway() ?? "http://localhost:20128/v1";
  const next = process.argv[process.argv.indexOf("--key") + 1];
  if (next !== undefined && !next.startsWith("-") && !isSubcommand(program, next)) {
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

export function registerKeyPrompt(program: Command): void {
  if (process.argv.some((a) => a.startsWith("--key="))) {
    console.error(inlineKeyError("<url>").message);
    process.exit(1);
  }

  program.hook("preAction", async () => {
    try {
      await promptForKey(program);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
}
