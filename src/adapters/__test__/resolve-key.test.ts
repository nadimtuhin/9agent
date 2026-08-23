import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { resolveKey } from "../../opts.js";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

test("an explicit --key wins over both env vars", () => {
  process.env.NINEROUTER_KEY = "from-env";
  assert.equal(resolveKey("from-flag"), "from-flag");
});

test("NINEROUTER_KEY wins over LOCAL_9ROUTER_KEY", () => {
  process.env.NINEROUTER_KEY = "primary";
  process.env.LOCAL_9ROUTER_KEY = "fallback";
  assert.equal(resolveKey(undefined), "primary");
});

test("LOCAL_9ROUTER_KEY is used when NINEROUTER_KEY is unset", () => {
  delete process.env.NINEROUTER_KEY;
  process.env.LOCAL_9ROUTER_KEY = "fallback";
  assert.equal(resolveKey(undefined), "fallback");
});

test("falls back to the sk_9router placeholder", () => {
  delete process.env.NINEROUTER_KEY;
  delete process.env.LOCAL_9ROUTER_KEY;
  assert.equal(resolveKey(undefined), "sk_9router");
});
