import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runDoctor, type DoctorDeps } from "../../doctor.js";
import type { AgentAdapter } from "../base.js";

function adapter(name: string, installed: boolean): AgentAdapter {
  return {
    name,
    aliases: [],
    detect: () => Promise.resolve(installed),
    launch: () => Promise.resolve(),
  };
}

/** Every dep injected: no network, no spawns, no PATH lookups. */
function deps(over: Partial<DoctorDeps> = {}): DoctorDeps {
  return {
    gateway: "http://gw.test/v1",
    keySource: "NINEROUTER_KEY",
    adapters: [adapter("claude", true), adapter("pi", false)],
    fetchFn: () =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: "a", owned_by: "x" }] }), {
          status: 200,
        }),
      ),
    exec: () => Promise.resolve({ status: 0, stdout: "" }),
    ...over,
  };
}

describe("runDoctor", () => {
  it("exits 0 and marks every check ok when all pass", async () => {
    const r = await runDoctor(deps());
    assert.equal(r.exitCode, 0);
    assert.ok(r.checks.every((c) => c.status !== "fail"));
  });

  it("reports gateway status and model count", async () => {
    const r = await runDoctor(deps());
    const gw = r.checks.find((c) => c.name === "gateway");
    assert.equal(gw?.status, "ok");
    assert.match(gw?.detail ?? "", /200/);
    assert.match(gw?.detail ?? "", /1 model/);
  });

  it("fails, non-zero, when the gateway is unreachable", async () => {
    const r = await runDoctor(
      deps({ fetchFn: () => Promise.reject(new Error("ECONNREFUSED")) }),
    );
    assert.notEqual(r.exitCode, 0);
    assert.equal(r.checks.find((c) => c.name === "gateway")?.status, "fail");
  });

  it("fails on a non-2xx gateway response", async () => {
    const r = await runDoctor(
      deps({ fetchFn: () => Promise.resolve(new Response("nope", { status: 401 })) }),
    );
    assert.notEqual(r.exitCode, 0);
    assert.match(
      r.checks.find((c) => c.name === "gateway")?.detail ?? "",
      /401/,
    );
  });

  it("names the key source and NEVER prints the key itself", async () => {
    const secret = "sk-live-do-not-leak-abc123";
    const r = await runDoctor(deps({ keySource: "NINEROUTER_KEY", key: secret }));
    const key = r.checks.find((c) => c.name === "key");
    assert.match(key?.detail ?? "", /NINEROUTER_KEY/);
    // v0.2.1 was a security release because --help leaked a live credential.
    assert.doesNotMatch(r.report, new RegExp(secret));
    assert.ok(!JSON.stringify(r.checks).includes(secret));
  });

  it("warns when the key is only the local placeholder", async () => {
    const r = await runDoctor(deps({ keySource: "default", key: "sk_9router" }));
    assert.equal(r.checks.find((c) => c.name === "key")?.status, "warn");
    assert.equal(r.exitCode, 0, "a placeholder key is a warning, not a failure");
  });

  it("lists which agents are installed via each adapter's detect()", async () => {
    const r = await runDoctor(deps());
    const agents = r.checks.find((c) => c.name === "agents");
    assert.match(agents?.detail ?? "", /claude/);
    assert.doesNotMatch(agents?.detail ?? "", /\bpi\b/);
  });

  it("fails when no agent is installed at all", async () => {
    const r = await runDoctor(deps({ adapters: [adapter("claude", false)] }));
    assert.notEqual(r.exitCode, 0);
    assert.equal(r.checks.find((c) => c.name === "agents")?.status, "fail");
  });

  it("warns, does not fail, when Docker is missing (--sandbox only)", async () => {
    const r = await runDoctor(
      deps({ exec: () => Promise.resolve({ status: 127, stdout: "" }) }),
    );
    assert.equal(r.exitCode, 0, "Docker is optional — warning, not failure");
    assert.equal(r.checks.find((c) => c.name === "docker")?.status, "warn");
  });

  it("warns when the docker binary exists but the daemon is down", async () => {
    const r = await runDoctor(
      deps({
        exec: (_cmd, args) =>
          Promise.resolve(
            args.includes("info")
              ? { status: 1, stdout: "" }
              : { status: 0, stdout: "/usr/bin/docker" },
          ),
      }),
    );
    const d = r.checks.find((c) => c.name === "docker");
    assert.equal(d?.status, "warn");
    assert.match(d?.detail ?? "", /daemon/i);
    assert.equal(r.exitCode, 0);
  });

  it("renders one scannable line per check with a pass/fail marker", async () => {
    const r = await runDoctor(deps());
    const lines = r.report.trim().split("\n");
    assert.equal(lines.length, r.checks.length);
    for (const l of lines) assert.match(l, /^[^\s]+\s+\w+/);
  });
});
