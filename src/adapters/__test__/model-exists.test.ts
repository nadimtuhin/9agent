import assert from "node:assert/strict";
import { test } from "node:test";
import { assertModelExists } from "../../opts.js";

const IDS = ["free", "sonnet-4-6", "opus-4.6", "ag/claude-sonnet-4-6", "glm/glm-5.3"];

test("an exact id passes", () => {
  assert.doesNotThrow(() => assertModelExists("sonnet-4-6", IDS));
});

test("a plausible typo is rejected, not passed through", () => {
  // An id absent from the gateway list must fail at launch, never reach the agent.
  assert.throws(() => assertModelExists("sonnet-4-5", IDS), /not served by this gateway/);
});

test("a near miss suggests the real id", () => {
  assert.throws(() => assertModelExists("claude-sonnet-4-6", IDS), /ag\/claude-sonnet-4-6/);
});

test("a wild miss points at the picker instead of guessing", () => {
  assert.throws(() => assertModelExists("gpt-4", IDS), /without --model to pick from the 5/);
});

test("substring alone does not count as a match", () => {
  assert.throws(() => assertModelExists("sonnet", IDS), /not served by this gateway/);
});
