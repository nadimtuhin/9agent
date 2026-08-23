import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runUpdate, type Exec } from "../../update.js";

/** Records what would be spawned, so no test ever touches the global npm prefix. */
function fakeExec(result = { status: 0, stderr: "" }) {
  const calls: string[][] = [];
  const exec: Exec = (cmd, args) => {
    calls.push([cmd, ...args]);
    return Promise.resolve(result);
  };
  return { calls, exec };
}

describe("runUpdate", () => {
  it("installs the latest published version globally", async () => {
    const npm = fakeExec();
    const msg = await runUpdate({ exec: npm.exec });
    assert.deepEqual(npm.calls, [["npm", "install", "-g", "9agent@latest"]]);
    assert.match(msg, /9agent@latest/);
  });

  it("spawns nothing on --dry-run, but still says what it would run", async () => {
    const npm = fakeExec();
    const msg = await runUpdate({ exec: npm.exec, dryRun: true });
    assert.deepEqual(npm.calls, []);
    assert.match(msg, /npm install -g 9agent@latest/);
  });

  it("surfaces npm's own stderr when the install fails", async () => {
    const npm = fakeExec({ status: 1, stderr: "EACCES: permission denied" });
    await assert.rejects(() => runUpdate({ exec: npm.exec }), /EACCES: permission denied/);
  });

  it("reports the exit code when npm fails silently", async () => {
    const npm = fakeExec({ status: 243, stderr: "" });
    await assert.rejects(() => runUpdate({ exec: npm.exec }), /exit 243/);
  });
});
