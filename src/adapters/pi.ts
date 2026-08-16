import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AgentAdapter, LaunchOptions } from "./base.js";
import { runHost } from "../runner/host.js";

const execFileAsync = promisify(execFile);

export function buildPiArgs(opts: {
  model: string;
  yolo: boolean;
  extraArgs: string[];
}): string[] {
  // yolo is a confirmed no-op: Pi has no built-in permission system
  return ["--provider", "9router", "--model", opts.model, ...opts.extraArgs];
}

export const piAdapter: AgentAdapter = {
  name: "pi",
  aliases: ["p"],
  async detect() {
    return new Promise((resolve) => {
      execFileAsync("which", ["pi"])
        .then(() => resolve(true))
        .catch(() => resolve(false));
    });
  },
  async launch(opts: LaunchOptions) {
    // Refuse rather than run unsandboxed: silently dropping a security-shaped
    // flag is worse than not supporting it.
    if (opts.sandbox) {
      throw new Error(
        "pi: --sandbox is claude-only for now. Pi routes through ~/.pi/agent/models.json, " +
          "which the sandbox cannot point at the container host without editing a file you own. " +
          "Use `9pi --sandbox` until 9agent supports it.",
      );
    }

    const args = buildPiArgs(opts);

    if (opts.dryRun) {
      console.error("--- pi dry run ---");
      console.error("args:", args);
      console.error(
        "(pi uses models.json for gateway routing, not env vars)",
      );
      return;
    }

    // Pi env only carries provider API keys, not base URL.
    // Custom gateway needs models.json seeding (v2).
    const expected = "http://localhost:20128/v1";
    if (opts.baseUrl !== expected) {
      console.error(
        `pi: base URL is ${opts.baseUrl}, expected ${expected}. Custom gateway needs models.json seeding (v2).`,
      );
    }

    if (opts.yolo) {
      console.error(
        "pi: --yolo is a no-op; Pi has no built-in permission system. Run sandboxed externally if needed.",
      );
    }

    await runHost("pi", args, {});
  },
};
