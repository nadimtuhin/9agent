import { spawn } from "node:child_process";
import type { SpawnOptions } from "node:child_process";

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
    child.on("exit", (code, _signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${bin} exited with code ${code ?? "null"}`));
    });
  });
}
