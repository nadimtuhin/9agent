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
    child.on("exit", (code, signal) => {
      if (signal) process.exit(128 + (os.constants.signals[signal] ?? 15));
      if (code === 0) resolve();
      else process.exit(code ?? 1);
    });
  });
}
