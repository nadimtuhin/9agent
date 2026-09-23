import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

/** Same as run(), but with a throwaway HOME so ~/.config/9agent/models.json
 *  cannot answer for the gateway. Without this, a warm cache on the dev box
 *  turns "gateway unreachable" into a cache hit and the test result depends on
 *  whether 9agent happened to run recently. Mirrors release.sh's FAKE_HOME. */
function runWithKey(...args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", CLI, ...args], {
    encoding: "utf-8",
    timeout: 10_000,
    env: { ...process.env, NINEROUTER_KEY: "sk-must-not-appear" },
  });
}

function runIsolated(...args: string[]) {
  const home = mkdtempSync(join(tmpdir(), "9agent-test-"));
  try {
    return spawnSync(process.execPath, ["--import", "tsx", CLI, ...args], {
      encoding: "utf-8",
      timeout: 10_000,
      // npm_config_prefix as well as HOME: `update` runs a real
      // `npm install -g` on its live path, and a flag regression that leaves
      // dryRun undefined would otherwise overwrite the developer's global
      // 9agent binary from the test suite. It already happened once.
      env: { ...process.env, HOME: home, npm_config_prefix: home },
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe("update subcommand routing", () => {
  // Regression: `.argument("[args...]")` on the root command swallowed `update`
  // and forwarded it to the agent as a passthrough arg. Commander only matches
  // the subcommand first because it is registered ahead of the root action.
  it("runs update instead of forwarding it to an agent", () => {
    const r = runIsolated("update", "--force", "--dry-run");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /npm install -g 9agent@latest/);
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
    const r = runWithKey("doctor", "--gateway", DEAD);
    assert.doesNotMatch(r.stdout + r.stderr, /sk-must-not-appear/);
    // The report names the source (an env var, or saved profile) and withholds the
    // value. Which source wins depends on the environment, so assert the shape.
    assert.match(r.stdout, /resolved from .+ \(value not shown\)|local placeholder/);
  });

  it("lists doctor in --help", () => {
    const r = run("--help");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^\s*doctor\s/m);
  });
});

describe("doctor --json", () => {
  const DEAD = "http://127.0.0.1:1/v1";

  it("emits one parseable object, and no human report", () => {
    const r = run("doctor", "--gateway", DEAD, "--json");
    const parsed = JSON.parse(r.stdout) as { ok: boolean; checks: { name: string }[] };
    assert.equal(parsed.ok, false);
    assert.deepEqual(
      parsed.checks.map((c) => c.name),
      ["gateway", "key", "agents", "docker"],
    );
    assert.doesNotMatch(r.stdout, /✔|✘/);
  });

  it("withholds the key value in JSON too", () => {
    const r = runWithKey("doctor", "--gateway", DEAD, "--json");
    assert.doesNotMatch(r.stdout + r.stderr, /sk-must-not-appear/);
  });
});

describe("--key", () => {
  it("refuses an inline value instead of forwarding it to the agent", () => {
    // Commander would otherwise hand a bare "--key token" to [args...], and the
    // key would reach the agent's argv.
    const r = runIsolated("--key", "sk-inline", "-a", "claude", "--print-only", "-m", "x");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no longer takes a value/);
    assert.doesNotMatch(r.stdout, /sk-inline/);
  });

  it("refuses --key=value without echoing the value", () => {
    // Commander's own "unknown option '--key=…'" error would print the token.
    const r = runIsolated("--key=sk-inline", "-a", "claude", "--print-only", "-m", "x");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no longer takes a value/);
    assert.doesNotMatch(r.stdout + r.stderr, /sk-inline/);
  });

  it("treats a following subcommand name as a subcommand, not a key", () => {
    // `help` is added lazily by commander, so it is not in program.commands.
    const r = runIsolated("--key", "help");
    assert.doesNotMatch(r.stderr, /no longer takes a value/);
  });

  it("will not prompt without a terminal", () => {
    const r = runIsolated("--key", "-a", "claude", "--print-only", "-m", "x");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /needs a terminal/);
  });
});

describe("models subcommand", () => {
  it("fails legibly when the gateway is unreachable", () => {
    const r = runIsolated("models", "--gateway", "http://127.0.0.1:1/v1");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Is 9Router running\?/);
  });

  it("lists models in --help", () => {
    const r = run("--help");
    assert.match(r.stdout, /^\s*models\s/m);
  });
});
