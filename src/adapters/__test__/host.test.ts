import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// runHost calls process.exit, so it can only be observed from a child.
const HOST = fileURLToPath(new URL("../../runner/host.ts", import.meta.url));
const ROOT = join(fileURLToPath(new URL("../../..", import.meta.url)));

function runInChild(
  shellCmd: string,
  overlay: Record<string, string> = {},
  parentEnv: Record<string, string> = {},
): Promise<number> {
  const script = `import { runHost } from ${JSON.stringify(HOST)};
await runHost("sh", ["-c", ${JSON.stringify(shellCmd)}], ${JSON.stringify(overlay)});`;
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", script],
      { cwd: ROOT, env: { ...process.env, ...parentEnv } },
      (err) => {
        if (err && typeof err.code === "number") resolve(err.code);
        else if (err) reject(err);
        else resolve(0);
      },
    );
  });
}

describe("runHost", () => {
  it("mirrors a non-zero exit code", async () => {
    assert.equal(await runInChild("exit 7"), 7);
  });

  it("resolves on success", async () => {
    assert.equal(await runInChild("exit 0"), 0);
  });

  it("reports 128+signal, distinguishing SIGKILL from SIGTERM", async () => {
    assert.equal(await runInChild("kill -KILL $$"), 137);
    assert.equal(await runInChild("kill -TERM $$"), 143);
  });

  // The sandbox passes API keys as `docker run -e NAME` (value read from the
  // docker client's env), so runHost's env must be layered over process.env:
  // PATH, HOME and DOCKER_* have to survive or docker itself cannot run.
  it("layers env over the parent environment instead of replacing it", async () => {
    const check =
      '[ -n "$PATH" ] && [ "$KEEP_ME" = parent ] && [ "$NEW_KEY" = secret ] && [ "$SHADOWED" = overlay ]';
    assert.equal(
      await runInChild(
        check,
        { NEW_KEY: "secret", SHADOWED: "overlay" },
        { KEEP_ME: "parent", SHADOWED: "parent" },
      ),
      0,
    );
  });
});
