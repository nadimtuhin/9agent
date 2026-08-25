import { describe, it } from "node:test";
import assert from "node:assert/strict";

function fakeFetcher(latestVersion: string, opts?: { ok?: boolean }) {
  return async (_url: string) => ({
    ok: opts?.ok ?? true,
    json: async () => ({ version: latestVersion }),
  });
}

function failingFetcher() {
  return async (_url: string) => {
    throw new Error("network down");
  };
}

describe("checkForUpdate", () => {
  it("returns update available when latest is newer", async () => {
    const { checkForUpdate } = await import("../../update-check.js");
    const result = await checkForUpdate("1.0.0", {
      fetcher: fakeFetcher("2.0.0"),
      skipCache: true,
    });
    assert.equal(result.current, "1.0.0");
    assert.equal(result.latest, "2.0.0");
    assert.equal(result.updateAvailable, true);
  });

  it("returns no update when versions match", async () => {
    const { checkForUpdate } = await import("../../update-check.js");
    const result = await checkForUpdate("1.0.0", {
      fetcher: fakeFetcher("1.0.0"),
      skipCache: true,
    });
    assert.equal(result.updateAvailable, false);
  });

  it("falls back to current version when fetch fails", async () => {
    const { checkForUpdate } = await import("../../update-check.js");
    const result = await checkForUpdate("1.0.0", {
      fetcher: failingFetcher(),
      skipCache: true,
    });
    assert.equal(result.latest, "1.0.0");
    assert.equal(result.updateAvailable, false);
  });
});

describe("printUpdateNotice", () => {
  it("writes notice to stderr when update available", async () => {
    const { printUpdateNotice } = await import("../../update-check.js");
    let output = "";
    const originalWrite = process.stderr.write.bind(process.stderr);
    const mock: typeof process.stderr.write = (data: string | Uint8Array) => {
      output += typeof data === "string" ? data : new TextDecoder().decode(data);
      return true;
    };
    process.stderr.write = mock;
    try {
      printUpdateNotice({
        current: "1.0.0",
        latest: "2.0.0",
        updateAvailable: true,
      });
      assert.match(output, /2\.0\.0/);
      assert.match(output, /1\.0\.0/);
    } finally {
      process.stderr.write = originalWrite;
    }
  });

  it("writes nothing when already on latest", async () => {
    const { printUpdateNotice } = await import("../../update-check.js");
    let output = "";
    const originalWrite = process.stderr.write.bind(process.stderr);
    const mock: typeof process.stderr.write = (data: string | Uint8Array) => {
      output += typeof data === "string" ? data : new TextDecoder().decode(data);
      return true;
    };
    process.stderr.write = mock;
    try {
      printUpdateNotice({
        current: "1.0.0",
        latest: "1.0.0",
        updateAvailable: false,
      });
      assert.equal(output, "");
    } finally {
      process.stderr.write = originalWrite;
    }
  });
});
