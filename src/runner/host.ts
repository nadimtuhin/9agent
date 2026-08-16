import { spawn } from "node:child_process";
import type { SpawnOptions } from "node:child_process";
import os from "node:os";

export async function runHost(
  bin: string,
  args: string[],
  env: Record<string, string>,
): Promise<void> {
  const options: SpawnOptions = {
    stdio: "inherit",
    env: { ...process.env, ...env },
  };

  const child = spawn(bin, args, options);
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    // ponytail: the launcher is a passthrough — mirror the child's fate, don't
    // interpret it. Signals (Ctrl-C) exit silently; codes propagate verbatim.
    child.on("exit", (code, signal) => {
      if (signal) process.exit(128 + (os.constants.signals[signal] ?? 15));
      if (code === 0) resolve();
      else process.exit(code ?? 1);
    });
  });
}
