import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const ENTRY = fileURLToPath(new URL("../../../dist/index.js", import.meta.url));

/** How long /v1/models stalls. Must exceed the moment we sample the screen by
 *  enough that a serial implementation could not have painted the picker yet. */
const RESPONSE_DELAY_MS = 1500;
/** When the primary assertion samples the rendered screen. */
const SAMPLE_AT_MS = 300;

function tmux(...args: string[]): string {
  return execFileSync("tmux", args, { encoding: "utf-8", timeout: 10_000 });
}

/** A gateway that answers /v1/models only after RESPONSE_DELAY_MS, recording
 *  when the request landed and when the body went out. */
function startSlowGateway() {
  let arrivedAt: number | undefined;
  let respondedAt: number | undefined;
  const server = http.createServer((req, res) => {
    arrivedAt = Date.now();
    setTimeout(() => {
      respondedAt = Date.now();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "slow/model", owned_by: "stub" }] }));
    }, RESPONSE_DELAY_MS);
  });
  return new Promise<{
    port: number;
    close: () => void;
    arrivedAt: () => number | undefined;
    respondedAt: () => number | undefined;
  }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") throw new Error("no port");
      resolve({
        port: addr.port,
        close: () => server.close(),
        arrivedAt: () => arrivedAt,
        respondedAt: () => respondedAt,
      });
    });
  });
}

describe("model prefetch overlaps the agent picker", () => {
  // The claim: main() kicks off discoverModels() BEFORE the agent picker, so the
  // picker paints while the gateway request is still in flight.
  //
  // Why the obvious test is worthless: "picker visible AND request arrived" at
  // some instant is also true of serial code on a fast machine. The proof is
  // ordering against the stub's own delay — the picker must be on screen while
  // the stub is provably still sleeping. Serial code would still be blocked in
  // the fetch at that moment, so no picker could exist.
  //
  // Skipped in CI: the 300ms sample window is too tight for shared runners whose
  // scheduler may not give the child process a timeslice fast enough. The test
  // is meaningful locally with a dedicated TTY.
  const skip = !!process.env.CI;
  it("paints 'Pick an agent:' while /v1/models is still in flight", { skip }, async () => {
    // A missing tmux means no proof, not a pass. Fail loudly.
    const probe = spawnSync("tmux", ["-V"], { encoding: "utf-8", timeout: 10_000 });
    assert.equal(
      probe.status,
      0,
      "tmux is required for this test (it reads the rendered screen, not the raw byte stream)",
    );

    const gw = await startSlowGateway();
    const session = `9agent-overlap-${process.pid}`;
    try {
      tmux(
        "-f",
        "/dev/null",
        "new-session",
        "-d",
        "-s",
        session,
        "-x",
        "100",
        "-y",
        "30",
        "-c",
        ROOT,
        `node ${ENTRY} --no-update --gateway http://127.0.0.1:${gw.port}/v1`,
      );

      await sleep(SAMPLE_AT_MS);
      const screen = tmux("capture-pane", "-p", "-t", session);

      // PRIMARY ASSERTION — all three at the same instant:
      assert.match(screen, /Pick an agent:/, `picker not painted at ${SAMPLE_AT_MS}ms:\n${screen}`);
      assert.ok(gw.arrivedAt() !== undefined, "gateway request had not been issued yet");
      assert.equal(
        gw.respondedAt(),
        undefined,
        "stub already responded — the delay is too short to prove anything",
      );

      // Corroboration: the deferred await really is downstream of the picker.
      tmux("send-keys", "-t", session, "Enter");
      await sleep(400);
      assert.match(tmux("capture-pane", "-p", "-t", session), /Loading models/);

      // And the in-flight fetch resolves into the model picker.
      await sleep(1400);
      const models = tmux("capture-pane", "-p", "-t", session);
      assert.match(models, /Pick a model:/, models);
      assert.match(models, /slow\/model/, models);
    } finally {
      spawnSync("tmux", ["kill-session", "-t", session], { timeout: 10_000 });
      gw.close();
    }
  });
});
