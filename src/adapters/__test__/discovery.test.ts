import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverModels } from "../../discovery.js";

const CACHE_DIR = mkdtempSync(join(tmpdir(), "9agent-test-"));
const cache = join(CACHE_DIR, "models.json");
writeFileSync(cache, JSON.stringify([{ id: "cached/model", owned_by: "cache" }]));

let server: Server;
let base: string;
let mode: "401" | "503" | "html" | "bad-data" | "ok" = "ok";

before(async () => {
  server = createServer((_req, res) => {
    if (mode === "401") {
      res.writeHead(401).end("nope");
    } else if (mode === "503") {
      res.writeHead(503).end("upstream down");
    } else if (mode === "html") {
      res.writeHead(200, { "content-type": "text/html" }).end("<html>502</html>");
    } else if (mode === "bad-data") {
      res.writeHead(200).end(JSON.stringify({ data: [null] }));
    } else {
      res
        .writeHead(200)
        .end(JSON.stringify({ data: [{ id: "live/model", owned_by: "live" }] }));
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/v1`;
});

after(() => server.close());

describe("discoverModels", () => {
  it("throws on 401 instead of serving cache", async () => {
    mode = "401";
    await assert.rejects(() => discoverModels(base, "k", cache), /HTTP 401/);
  });

  it("falls back to cache on HTTP 5xx, with a stderr note", async () => {
    mode = "503";
    writeFileSync(cache, JSON.stringify([{ id: "cached/model", owned_by: "cache" }]));
    const warnings: string[] = [];
    const original = console.error;
    console.error = (msg: unknown) => void warnings.push(String(msg));
    try {
      const models = await discoverModels(base, "k", cache);
      assert.deepEqual(models, [{ id: "cached/model", owned_by: "cache" }]);
    } finally {
      console.error = original;
    }
    assert.match(warnings.join("\n"), /HTTP 503/);
    assert.match(warnings.join("\n"), /from cache/);
  });

  it("throws on 5xx when there is no cache to fall back on", async () => {
    mode = "503";
    const empty = join(CACHE_DIR, "empty503.json");
    writeFileSync(empty, "[]");
    await assert.rejects(() => discoverModels(base, "k", empty), /HTTP 503/);
  });

  it("throws a named error on invalid JSON", async () => {
    mode = "html";
    await assert.rejects(() => discoverModels(base, "k", cache), /invalid JSON/);
  });

  it("rejects a malformed data array instead of caching it", async () => {
    mode = "bad-data";
    await assert.rejects(() => discoverModels(base, "k", cache), /valid 'data' array/);
  });

  it("returns live models when the gateway is healthy", async () => {
    mode = "ok";
    const models = await discoverModels(base, "k", cache);
    assert.deepEqual(models, [{ id: "live/model", owned_by: "live" }]);
  });

  it("falls back to cache only on transport failure, and says so", async () => {
    writeFileSync(cache, JSON.stringify([{ id: "cached/model", owned_by: "cache" }]));
    const warnings: string[] = [];
    const original = console.error;
    console.error = (msg: unknown) => void warnings.push(String(msg));
    try {
      const models = await discoverModels("http://127.0.0.1:1/v1", "k", cache);
      assert.deepEqual(models, [{ id: "cached/model", owned_by: "cache" }]);
    } finally {
      console.error = original;
    }
    // CONTEXT.md makes announcing a cache hit a domain requirement.
    assert.match(warnings.join("\n"), /from cache/);
  });

  it("treats an empty cache as no cache", async () => {
    const empty = join(CACHE_DIR, "empty.json");
    writeFileSync(empty, "[]");
    await assert.rejects(
      () => discoverModels("http://127.0.0.1:1/v1", "k", empty),
      /no cached models/,
    );
  });

  it("ignores a malformed cache", async () => {
    const bad = join(CACHE_DIR, "bad.json");
    writeFileSync(bad, JSON.stringify([{ nope: true }]));
    await assert.rejects(
      () => discoverModels("http://127.0.0.1:1/v1", "k", bad),
      /no cached models/,
    );
  });
});
