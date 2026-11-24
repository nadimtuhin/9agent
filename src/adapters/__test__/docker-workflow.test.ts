import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WORKFLOW = fileURLToPath(
  new URL("../../../.github/workflows/docker.yml", import.meta.url),
);

// The Docker job is path-filtered. The sandbox images install dependencies
// from the lockfile, so a lockfile-only change must still run the job.
describe("docker workflow path filters", () => {
  const yml = readFileSync(WORKFLOW, "utf8");
  const filters = [...yml.matchAll(/^\s*paths:\s*\[(.*)\]\s*$/gm)].map((m) =>
    m[1].split(",").map((p) => p.trim().replace(/^['"]|['"]$/g, "")),
  );

  it("has a path filter for both push and pull_request", () => {
    assert.equal(filters.length, 2);
  });

  for (const required of ["pnpm-lock.yaml", "package.json", ".github/workflows/docker.yml"]) {
    it(`triggers on ${required}`, () => {
      for (const paths of filters) assert.ok(paths.includes(required), paths.join(", "));
    });
  }
});
