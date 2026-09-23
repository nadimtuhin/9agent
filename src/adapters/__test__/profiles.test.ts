import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveKey, savedKey } from "../../profiles.js";

function tempConfig(): string {
  return join(mkdtempSync(join(tmpdir(), "9agent-profiles-")), "nested", "config.json");
}

describe("gateway profiles", () => {
  it("returns undefined before anything is saved", () => {
    assert.equal(savedKey("https://gw/v1", tempConfig()), undefined);
  });

  it("keeps one key per gateway, ignoring a trailing slash", () => {
    const path = tempConfig();
    saveKey("https://a/v1", "key-a", path);
    saveKey("https://b/v1/", "key-b", path);
    assert.equal(savedKey("https://a/v1/", path), "key-a");
    assert.equal(savedKey("https://b/v1", path), "key-b");
  });

  it("writes the file owner-only, since it holds credentials", () => {
    const path = tempConfig();
    saveKey("https://a/v1", "key-a", path);
    assert.equal(statSync(path).mode & 0o777, 0o600);
  });

  it("refuses to overwrite a config it cannot parse", () => {
    // Treating a corrupt file as empty would make the save wipe every profile.
    const path = join(mkdtempSync(join(tmpdir(), "9agent-profiles-")), "config.json");
    writeFileSync(path, "{ not json");
    assert.throws(() => saveKey("https://a/v1", "k", path), /not valid JSON/);
    assert.equal(readFileSync(path, "utf-8"), "{ not json");
  });
});
