import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  claudeSpec,
  gitconfigIfPresent,
  readOnlyPathsIn,
  resolveImage,
  shadowConfigDir,
  writeShadowConfig,
  type SandboxSpec,
} from "../../runner/sandbox.js";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "9agent-test-"));
}

describe("shadowConfigDir", () => {
  it("is derived and stable, so a crashed run leaves nothing to clean up", () => {
    assert.equal(shadowConfigDir("pi"), join(homedir(), ".cache", "9agent", "sandbox", "pi"));
    assert.equal(shadowConfigDir("pi"), shadowConfigDir("pi"));
  });

  it("keeps agents apart", () => {
    assert.notEqual(shadowConfigDir("pi"), shadowConfigDir("hermes"));
  });
});

describe("writeShadowConfig", () => {
  // A unique agent name per run keeps these out of the real ~/.cache/9agent
  // entries that a live sandbox uses.
  const agent = `test-shadow-${process.pid}`;

  it("rewrites loopback URLs and never touches the original", () => {
    const src = join(tmp(), "config.yaml");
    const original = 'base_url: "http://127.0.0.1:20128/v1"\n';
    writeFileSync(src, original);

    try {
      const target = writeShadowConfig(agent, "config.yaml", src);

      assert.notEqual(target, src);
      assert.match(readFileSync(target, "utf-8"), /host\.docker\.internal:20128/);
      assert.equal(readFileSync(src, "utf-8"), original, "source must be read-only");
    } finally {
      rmSync(shadowConfigDir(agent), { recursive: true, force: true });
    }
  });

  it("inherits the source's mode, so a 0600 config does not become world-readable", () => {
    const src = join(tmp(), "creds.json");
    writeFileSync(src, "{}\n");
    chmodSync(src, 0o600);

    try {
      const target = writeShadowConfig(agent, "creds.json", src);
      assert.equal(statSync(target).mode & 0o777, 0o600);
    } finally {
      rmSync(shadowConfigDir(agent), { recursive: true, force: true });
    }
  });

  it("creates missing parent directories for a nested name", () => {
    const src = join(tmp(), "models.json");
    writeFileSync(src, "[]\n");

    try {
      const target = writeShadowConfig(agent, join("agent", "models.json"), src);
      assert.equal(readFileSync(target, "utf-8"), "[]\n");
    } finally {
      rmSync(shadowConfigDir(agent), { recursive: true, force: true });
    }
  });
});

describe("readOnlyPathsIn", () => {
  it("keeps only what exists, because Docker errors on a missing bind source", () => {
    const home = tmp();
    mkdirSync(join(home, "hooks"));
    writeFileSync(join(home, "settings.json"), "{}");

    assert.deepEqual(
      readOnlyPathsIn(home, ["settings.json", "hooks", "plugins", "CLAUDE.md"]),
      ["settings.json", "hooks"],
    );
  });

  it("returns nothing for an agent home that does not exist at all", () => {
    assert.deepEqual(readOnlyPathsIn(join(tmp(), "absent"), ["settings.json"]), []);
  });

  it("preserves the caller's order, since nested mounts layer in sequence", () => {
    const home = tmp();
    for (const p of ["a", "b", "c"]) mkdirSync(join(home, p));
    assert.deepEqual(readOnlyPathsIn(home, ["c", "a", "b"]), ["c", "a", "b"]);
  });
});

describe("resolveImage", () => {
  function specFor(dockerfile: string, buildRevision?: () => string): SandboxSpec {
    return {
      repo: "9agent/test",
      dockerfile,
      agentHome: "/home/u/.x",
      containerHome: "/home/node/.x",
      gitconfigTarget: "/home/node/.gitconfig",
      buildRevision,
    };
  }

  it("tags by Dockerfile content, so an edit forces a rebuild", () => {
    const dir = tmp();
    const df = join(dir, "a.Dockerfile");

    writeFileSync(df, "FROM node:22-slim\n");
    const before = resolveImage(specFor(df));

    writeFileSync(df, "FROM node:22-slim\nRUN true\n");
    const after = resolveImage(specFor(df));

    assert.notEqual(before, after);
    assert.match(before, /^9agent\/test:[0-9a-f]{12}$/);
  });

  it("is stable for identical content at a different path", () => {
    const dir = tmp();
    const [a, b] = [join(dir, "a"), join(dir, "b")];
    writeFileSync(a, "FROM scratch\n");
    writeFileSync(b, "FROM scratch\n");

    assert.equal(resolveImage(specFor(a)), resolveImage(specFor(b)));
  });

  it("folds buildRevision into the tag, so an upstream checkout cannot go stale", () => {
    const df = join(tmp(), "a.Dockerfile");
    writeFileSync(df, "FROM scratch\n");

    assert.notEqual(
      resolveImage(specFor(df, () => "rev-one")),
      resolveImage(specFor(df, () => "rev-two")),
    );
  });
});

describe("claudeSpec", () => {
  it("uses the sudo-free image by default", () => {
    delete process.env.NINEAGENT_SANDBOX_ROOT;
    assert.match(claudeSpec().dockerfile, /\/claude\.Dockerfile$/);
  });

  it("switches to the root image only when NINEAGENT_SANDBOX_ROOT is set", () => {
    delete process.env.NINEAGENT_SANDBOX_ROOT;
    const plain = resolveImage(claudeSpec());

    process.env.NINEAGENT_SANDBOX_ROOT = "1";
    try {
      const spec = claudeSpec();
      assert.match(spec.dockerfile, /\/claude-root\.Dockerfile$/);
      // Same repo, but the tag is a content hash, so the two never collide.
      assert.notEqual(resolveImage(spec), plain);
    } finally {
      delete process.env.NINEAGENT_SANDBOX_ROOT;
    }
  });
});

describe("gitconfigIfPresent", () => {
  it("returns ~/.gitconfig or undefined, never a path that does not exist", () => {
    const found = gitconfigIfPresent();
    if (found !== undefined) {
      assert.equal(found, join(homedir(), ".gitconfig"));
      assert.doesNotThrow(() => statSync(found));
    }
  });
});
