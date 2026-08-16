import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseYes } from "../../opts.js";

describe("parseYes", () => {
  it("maps safe/dangerous", () => {
    assert.equal(parseYes("safe"), false);
    assert.equal(parseYes("dangerous"), true);
  });
  it("rejects anything else", () => {
    assert.throws(() => parseYes("yes"), /must be 'safe' or 'dangerous'/);
  });
});
