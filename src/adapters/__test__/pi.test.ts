import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { piKnowsModel } from "../pi.js";

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
