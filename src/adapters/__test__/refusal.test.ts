import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertSandboxSupported, type AgentAdapter } from "../base.js";

const fake = (over: Partial<AgentAdapter>): AgentAdapter => ({
  name: "fake",
  aliases: [],
  async detect() {
    return true;
  },
  async launch() {},
  ...over,
});

// Every shipped adapter now sets supportsSandbox: true, so this branch is only
// reachable by a NEW adapter — the moment it matters most and is least watched.
describe("assertSandboxSupported", () => {
  it("refuses an adapter that omits the field, rather than running unsandboxed", () => {
    assert.throws(() => assertSandboxSupported(fake({})), /not supported/);
  });

  it("prefers the adapter's own explanation when it has one", () => {
    assert.throws(
      () => assertSandboxSupported(fake({ sandboxRefusal: "fake: no image exists yet." })),
      /no image exists yet/,
    );
  });

  it("lets a supporting adapter through", () => {
    assert.doesNotThrow(() => assertSandboxSupported(fake({ supportsSandbox: true })));
  });
});
