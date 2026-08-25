import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  filterModels,
  resolveExplicitModel,
  type ModelEntry,
} from "../../discovery.js";

const MODELS: ModelEntry[] = [
  { id: "anthropic/claude-sonnet-4-20250514", owned_by: "anthropic" },
  { id: "openai/gpt-5", owned_by: "openai" },
  { id: "google/gemini-3.6-flash", owned_by: "google" },
];

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

describe("filterModels (case-insensitive picker search)", () => {
  it("matches when the query is the wrong case", () => {
    const out = filterModels(MODELS, "claude");
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "anthropic/claude-sonnet-4-20250514");
  });

  it("matches the owned_by field case-insensitively", () => {
    const out = filterModels(MODELS, "OPENAI");
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "openai/gpt-5");
  });

  it("returns everything when the input is empty", () => {
    assert.equal(filterModels(MODELS, "").length, MODELS.length);
  });

  it("returns nothing when nothing matches", () => {
    assert.equal(filterModels(MODELS, "zzz-nope").length, 0);
  });
});

describe("resolveExplicitModel (--model flag path)", () => {
  it("returns the flag unchanged when the gateway is reachable and the model exists", async () => {
    const out = fakeStream();
    const res = await resolveExplicitModel(
      "openai/gpt-5",
      Promise.resolve(MODELS),
      out,
    );
    assert.deepEqual(res, { model: "openai/gpt-5" });
    assert.deepEqual(out.chunks, []);
  });

  it("throws a typo error when the gateway is reachable but the model is missing", async () => {
    const out = fakeStream();
    await assert.rejects(
      () =>
        resolveExplicitModel(
          "openai/gpt-9000",
          Promise.resolve(MODELS),
          out,
        ),
      /not served by this gateway/,
    );
  });

  it("warns and proceeds (does NOT throw) when the gateway is unreachable", async () => {
    const out = fakeStream();
    const res = await resolveExplicitModel(
      "openai/gpt-5",
      Promise.reject(new Error("Cannot reach http://127.0.0.1:1/v1/models and no cached models")),
      out,
    );
    assert.equal(res.model, "openai/gpt-5");
    assert.match(res.warning ?? "", /gateway unreachable/);
    assert.match(res.warning ?? "", /anyway/);
  });

  it("omits the warning field when validation succeeds", async () => {
    const out = fakeStream();
    const res = await resolveExplicitModel(
      "openai/gpt-5",
      Promise.resolve(MODELS),
      out,
    );
    assert.equal(res.model, "openai/gpt-5");
    assert.equal(res.warning, undefined);
  });
});
