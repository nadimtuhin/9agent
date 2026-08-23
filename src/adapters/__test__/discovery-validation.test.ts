import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isModelEntryArray } from "../../discovery.js";

// This guard is the only thing standing between a malformed gateway response
// (or a corrupted cache file) and a crash deep in the model picker.
describe("isModelEntryArray", () => {
  it("accepts a well-formed model list", () => {
    assert.equal(
      isModelEntryArray([{ id: "lc/LongCat-2.0", owned_by: "longcat" }]),
      true,
    );
  });

  it("accepts an empty list", () => {
    assert.equal(isModelEntryArray([]), true);
  });

  it("ignores extra fields the gateway may add", () => {
    assert.equal(
      isModelEntryArray([{ id: "a", owned_by: "b", created: 1, object: "model" }]),
      true,
    );
  });

  it("rejects a non-array, including the {data: [...]} envelope itself", () => {
    assert.equal(isModelEntryArray({ data: [{ id: "a", owned_by: "b" }] }), false);
    assert.equal(isModelEntryArray(null), false);
    assert.equal(isModelEntryArray(undefined), false);
    assert.equal(isModelEntryArray("[]"), false);
  });

  it("rejects an entry missing either required field", () => {
    assert.equal(isModelEntryArray([{ id: "a" }]), false);
    assert.equal(isModelEntryArray([{ owned_by: "b" }]), false);
  });

  it("rejects an entry whose fields are the wrong type", () => {
    assert.equal(isModelEntryArray([{ id: 1, owned_by: "b" }]), false);
    assert.equal(isModelEntryArray([{ id: "a", owned_by: null }]), false);
  });

  it("rejects null entries, which typeof reports as 'object'", () => {
    assert.equal(isModelEntryArray([null]), false);
  });

  it("rejects a list where only some entries are valid", () => {
    assert.equal(
      isModelEntryArray([{ id: "a", owned_by: "b" }, { id: "c" }]),
      false,
    );
  });
});
