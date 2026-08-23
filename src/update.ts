import { spawn } from "node:child_process";

/** Injected so tests never touch the global npm prefix. */
export type Exec = (
  cmd: string,
  args: string[],
) => Promise<{ status: number; stderr: string }>;

const ARGS = ["install", "-g", "9agent@latest"];

const spawnExec: Exec = (cmd, args) =>
  new Promise((resolve) => {
    // stderr is piped, not inherited: a non-zero exit must carry npm's own
    // message into the thrown Error, where the user will actually read it.
    const child = spawn(cmd, args, { stdio: ["ignore", "inherit", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("error", (e) => {
      resolve({ status: 1, stderr: e.message });
    });
    child.on("close", (code) => {
      resolve({ status: code ?? 1, stderr });
    });
  });

export async function runUpdate(
  opts: { exec?: Exec; dryRun?: boolean } = {},
): Promise<string> {
  const cmdline = `npm ${ARGS.join(" ")}`;
  if (opts.dryRun) return `Would run: ${cmdline}`;

  const { status, stderr } = await (opts.exec ?? spawnExec)("npm", ARGS);
  if (status !== 0) {
    throw new Error(stderr.trim() || `${cmdline} failed with exit ${status}`);
  }
  return "Updated to 9agent@latest.";
}
