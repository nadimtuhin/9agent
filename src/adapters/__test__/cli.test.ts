import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseYes } from "../../opts.js";

describe("parseYes", () => {
  it("maps safe/dangerous", () => {
    assert.equal(parseYes("safe"), false);
    assert.equal(parseYes("dangerous"), true);
  });
  it("rejects anything else", () => {
    assert.throws(() => parseYes("yes"), /must be 'safe' or 'dangerous'/);
  });
});

const CLI = fileURLToPath(new URL("../../index.ts", import.meta.url));

/** Runs the real CLI end to end. tsx, not dist/, so the test cannot pass against
 *  a stale build. --dry-run keeps npm away from the global prefix. */
function run(...args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", CLI, ...args], {
    encoding: "utf-8",
    timeout: 10_000,
  });
}

describe("update subcommand routing", () => {
  // Regression: `.argument("[args...]")` on the root command swallowed `update`
  // and forwarded it to the agent as a passthrough arg. Commander only matches
  // the subcommand first because it is registered ahead of the root action.
  it("runs update instead of forwarding it to an agent", () => {
    const r = run("update", "--dry-run");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /npm install -g 9agent@latest/);
    // The agent path would have hit the picker or a gateway error instead.
    assert.doesNotMatch(r.stderr, /agent|gateway|9Router/i);
  });

  it("lists update in --help", () => {
    const r = run("--help");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^\s*update\s/m);
  });
});
