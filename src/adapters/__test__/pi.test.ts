import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { piKnowsModel, patchContextConfig } from "../pi.js";

const CONFIG = JSON.stringify({
  providers: {
    "9router": {
      baseUrl: "http://localhost:20128/v1",
      models: [{ id: "lc/LongCat-2.0" }, { id: "cc/claude-sonnet-5" }],
    },
  },
});

describe("piKnowsModel", () => {
  it("recognises a model pi has limits for", () => {
    assert.equal(piKnowsModel(CONFIG, "lc/LongCat-2.0"), true);
  });

  it("flags an id pi will guess the context limits for", () => {
    // 9agent's picker offers every gateway model; pi only knows models.json.
    assert.equal(piKnowsModel(CONFIG, "ag/gemini-3.7-flash-high"), false);
  });

  it("looks across every provider, not just the first", () => {
    const twoProviders = JSON.stringify({
      providers: {
        a: { models: [{ id: "x" }] },
        b: { models: [{ id: "y" }] },
      },
    });
    assert.equal(piKnowsModel(twoProviders, "y"), true);
  });

  // "cannot tell" must stay distinct from "not listed": warning on a config we
  // failed to read would fire on every launch and teach the user to ignore it.
  it("returns undefined for malformed JSON rather than warning", () => {
    assert.equal(piKnowsModel("<html>not json</html>", "anything"), undefined);
  });

  it("returns undefined when no provider lists any model", () => {
    assert.equal(piKnowsModel(JSON.stringify({ providers: {} }), "x"), undefined);
    assert.equal(piKnowsModel(JSON.stringify({}), "x"), undefined);
  });
});

const BASE = JSON.stringify({
  providers: {
    "9router": {
      baseUrl: "http://localhost:20128/v1",
      models: [
        { id: "cc/claude-sonnet-5", contextWindow: 200000, maxTokens: 32000, input: ["text", "image"] },
        { id: "cc/claude-haiku-4-5-20251001", contextWindow: 200000, maxTokens: 8000, input: ["text"] },
      ],
    },
  },
});

interface ParsedConfig {
  providers: Record<string, { models: { id: string; contextWindow?: number }[] }>;
}

describe("patchContextConfig", () => {
  it("updates contextWindow when the gateway reports a different value", () => {
    const out = patchContextConfig(BASE, "cc/claude-sonnet-5", 400000);
    const parsed = JSON.parse(out) as ParsedConfig;
    const entry = parsed.providers["9router"].models.find((m) => m.id === "cc/claude-sonnet-5");
    assert.equal(entry?.contextWindow, 400000);
  });

  it("leaves the config unchanged when contextWindow already matches", () => {
    const out = patchContextConfig(BASE, "cc/claude-sonnet-5", 200000);
    assert.equal(out, BASE);
  });

  it("does not touch other models in the same provider", () => {
    const out = patchContextConfig(BASE, "cc/claude-sonnet-5", 400000);
    const parsed = JSON.parse(out) as ParsedConfig;
    const other = parsed.providers["9router"].models.find((m) => m.id === "cc/claude-haiku-4-5-20251001");
    assert.equal(other?.contextWindow, 200000);
  });

  it("returns the config unchanged when the model id is not in it", () => {
    const out = patchContextConfig(BASE, "unknown/model", 128000);
    assert.equal(out, BASE);
  });
});
