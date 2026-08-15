import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { discoverModels } from "./discovery.js";

// Ponytail: single self-check — failsfast if 9Router down, asserts shape
describe("discoverModels", () => {
  it("returns non-empty array of model entries with id + owned_by", async () => {
    const url = process.env.NINEROUTER_URL ?? "http://localhost:20128/v1";
    const key = process.env.NINEROUTER_KEY ?? "sk_9router";
    const models = await discoverModels(url, key);
    assert.ok(models.length > 0, "expected at least one model");
    assert.ok(typeof models[0].id === "string");
    assert.ok(typeof models[0].owned_by === "string");
  });
});
