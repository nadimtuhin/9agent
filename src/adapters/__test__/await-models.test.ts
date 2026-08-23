import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { awaitModels, type ModelEntry } from "../../discovery.js";

const MODELS: ModelEntry[] = [{ id: "live/model", owned_by: "live" }];

/** Captures what would be drawn, so tests never emit escape codes into the real
 *  terminal — and so "wrote nothing" is assertable. */
function fakeStream() {
  const chunks: string[] = [];
  return {
    chunks,
    write: (s: string) => {
      chunks.push(s);
      return true;
    },
  };
}

// Two ticks, not one: awaitModels' own setImmediate and this one land in the
// same check phase, and the resumption between them is a microtask. One tick
// happens to work; two keeps the test from depending on that ordering.
async function tick() {
  await new Promise((r) => {
    setImmediate(r);
  });
}

describe("awaitModels", () => {
  it("draws nothing when the fetch already settled", async () => {
    const out = fakeStream();
    const got = await awaitModels(Promise.resolve(MODELS), { stream: out, isTTY: true });
    assert.deepEqual(got, MODELS);
    assert.deepEqual(out.chunks, []);
  });

  it("shows the hint, then clears it, when the fetch is still in flight", async () => {
    const out = fakeStream();
    let release!: (m: ModelEntry[]) => void;
    const pending = new Promise<ModelEntry[]>((r) => {
      release = r;
    });

    const p = awaitModels(pending, { stream: out, isTTY: true });
    await tick();
    await tick();
    assert.equal(out.chunks.join(""), "Loading models…");

    release(MODELS);
    assert.deepEqual(await p, MODELS);
    assert.equal(out.chunks.join(""), "Loading models…\r\x1b[K");
  });

  it("stays silent when stderr is not a TTY", async () => {
    const out = fakeStream();
    let release!: (m: ModelEntry[]) => void;
    const pending = new Promise<ModelEntry[]>((r) => {
      release = r;
    });

    const p = awaitModels(pending, { stream: out, isTTY: false });
    await tick();
    await tick();
    release(MODELS);
    await p;
    assert.deepEqual(out.chunks, []);
  });

  it("rethrows a rejection and still clears the hint", async () => {
    const out = fakeStream();
    let boom!: (e: Error) => void;
    const pending = new Promise<ModelEntry[]>((_resolve, reject) => {
      boom = reject;
    });

    const p = awaitModels(pending, { stream: out, isTTY: true });
    await tick();
    await tick();
    boom(new Error("gateway exploded"));

    await assert.rejects(() => p, /gateway exploded/);
    assert.ok(out.chunks.join("").endsWith("\r\x1b[K"));
  });
});
