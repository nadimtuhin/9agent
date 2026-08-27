import { Command } from "commander";
import process from "node:process";
import { discoverModels } from "./discovery.js";
import { resolveKey } from "./opts.js";
import { runUpdate } from "./update.js";
import { checkForUpdate } from "./update-check.js";
import { runDoctor, defaultDoctorDeps } from "./doctor.js";

export function effectiveGateway(opts: { gateway?: string }, root: { gateway?: string }): string {
  return opts.gateway ?? root.gateway ?? process.env.NINEROUTER_URL ?? "http://localhost:20128/v1";
}

function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("check the gateway, key, installed agents, and Docker")
    .option("--gateway <url>", "9Router base URL")
    .option("--key <token>", "9Router API key [env: NINEROUTER_KEY, LOCAL_9ROUTER_KEY]")
    .option("--json", "machine-readable output for CI")
    .action(async (opts: { gateway?: string; key?: string; json?: boolean }) => {
      const root = program.opts<{ gateway?: string; key?: string }>();
      const gateway = effectiveGateway(opts, root);
      const keyFlag = opts.key ?? root.key;
      const { checks, report, exitCode } = await runDoctor(
        defaultDoctorDeps({ gateway, key: resolveKey(keyFlag), keyFlag }),
      );
      process.stdout.write(opts.json ? JSON.stringify({ ok: exitCode === 0, checks }, null, 2) + "\n" : report);
      process.exit(exitCode);
    });
}

function registerModels(program: Command): void {
  program
    .command("models")
    .description("list the models the gateway serves")
    .option("--gateway <url>", "9Router base URL")
    .option("--key <token>", "9Router API key [env: NINEROUTER_KEY, LOCAL_9ROUTER_KEY]")
    .option("--json", "machine-readable output")
    .action(async (opts: { gateway?: string; key?: string; json?: boolean }) => {
      const root = program.opts<{ gateway?: string; key?: string }>();
      const gateway = effectiveGateway(opts, root);
      try {
        const models = await discoverModels(gateway, resolveKey(opts.key ?? root.key));
        const out = opts.json
          ? JSON.stringify(models, null, 2) + "\n"
          : models.map((m) => `${m.id}\t${m.owned_by}`).join("\n") + "\n";
        process.stdout.write(out);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}

function registerUpdate(program: Command, pkg: { version: string }): void {
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
}

export function registerCommands(program: Command, pkg: { version: string }): void {
  registerDoctor(program);
  registerModels(program);
  registerUpdate(program, pkg);
}
