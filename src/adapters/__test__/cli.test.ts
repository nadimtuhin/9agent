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

describe("doctor subcommand routing", () => {
  // Same regression as update: doctor shipped with passing unit tests while
  // nothing registered it, so `9agent doctor` fell through to [args...].
  // Port 1 is never listening, so the gateway check fails the same way on any
  // machine — no dependency on a live 9Router.
  const DEAD = "http://127.0.0.1:1/v1";

  it("runs doctor instead of forwarding it to an agent", () => {
    const r = run("doctor", "--gateway", DEAD);
    // Exit 1 is the gateway check failing, which is itself proof the
    // subcommand ran: the agent path would have opened a picker.
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /gateway/);
    assert.match(r.stdout, /agents/);
  });

  it("honours --gateway rather than falling back to the default", () => {
    // Regression: the subcommand declared a default for --gateway, so opts was
    // never undefined and the flag could not be told apart from "not passed".
    // doctor then reported on localhost while claiming to check the dead port.
    const r = run("doctor", "--gateway", DEAD);
    assert.match(r.stdout, /127\.0\.0\.1:1/);
    assert.doesNotMatch(r.stdout, /localhost:20128/);
  });

  it("never prints the key, only which source it came from", () => {
    const r = run("doctor", "--gateway", DEAD, "--key", "sk-must-not-appear");
    assert.doesNotMatch(r.stdout + r.stderr, /sk-must-not-appear/);
    // The report names the source (an env var, or --key) and withholds the
    // value. Which source wins depends on the environment, so assert the shape.
    assert.match(r.stdout, /resolved from .+ \(value not shown\)|local placeholder/);
  });

  it("lists doctor in --help", () => {
    const r = run("--help");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^\s*doctor\s/m);
  });
});
