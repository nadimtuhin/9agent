import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// ponytail: runHost calls process.exit, so it can only be observed from a child.
const HOST = fileURLToPath(new URL("../../runner/host.ts", import.meta.url));
const ROOT = join(fileURLToPath(new URL("../../..", import.meta.url)));

function runInChild(shellCmd: string): Promise<number> {
  const script = `import { runHost } from ${JSON.stringify(HOST)};
await runHost("sh", ["-c", ${JSON.stringify(shellCmd)}], {});`;
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", script],
      { cwd: ROOT },
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
});
