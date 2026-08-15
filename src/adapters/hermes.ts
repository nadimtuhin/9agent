import { AgentAdapter, LaunchOptions } from "./base.js";

export const hermesAdapter: AgentAdapter = {
  name: "hermes",
  aliases: ["h"],
  async detect() {
    // Stub: detect if binary on PATH so it appears in picker
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      await execFileAsync("which", ["hermes"]);
      return true;
    } catch {
      return false;
    }
  },
  async launch(_opts: LaunchOptions) {
    // Ponytail: stub until env/flag schema verified. Real impl = ship pi extension.
    throw new Error(
      "hermes: launch schema not confirmed yet. PR welcome with env/flag reference.",
    );
  },
};
