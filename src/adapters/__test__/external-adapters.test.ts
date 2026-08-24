import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAiderArgs } from "../aider.js";
import { buildClineArgs } from "../cline.js";
import { buildCodexArgs } from "../codex.js";
import { buildJcodeArgs } from "../jcode.js";
import { buildKilocodeArgs } from "../kilocode.js";
import { buildOpenCodeArgs } from "../opencode.js";

const CLI = fileURLToPath(new URL("../../index.ts", import.meta.url));

function runIsolated(...args: string[]) {
  const home = mkdtempSync(join(tmpdir(), "9agent-test-"));
  try {
    return spawnSync(process.execPath, ["--import", "tsx", CLI, ...args], {
      encoding: "utf-8",
      timeout: 10_000,
      env: { ...process.env, HOME: home, npm_config_prefix: home },
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

interface ExternalAdapterCase {
  name: string;
  aliases: string[];
  buildArgs: (opts: { model: string; yolo: boolean; extraArgs: string[] }) => string[];
  yoloFlag: string[];
  baseUrlEnv: string;
  apiKeyEnv: string;
}

const CASES: ExternalAdapterCase[] = [
  {
    name: "aider",
    aliases: ["a"],
    buildArgs: buildAiderArgs,
    yoloFlag: ["--yes-always"],
    baseUrlEnv: "OPENAI_API_BASE",
    apiKeyEnv: "OPENAI_API_KEY",
  },
  {
    name: "codex",
    aliases: ["cx"],
    buildArgs: buildCodexArgs,
    yoloFlag: ["--full-auto"],
    baseUrlEnv: "OPENAI_BASE_URL",
    apiKeyEnv: "OPENAI_API_KEY",
  },
  {
    name: "cline",
    aliases: ["cl"],
    buildArgs: buildClineArgs,
    yoloFlag: ["--auto-approve"],
    baseUrlEnv: "OPENAI_BASE_URL",
    apiKeyEnv: "OPENAI_API_KEY",
  },
  {
    name: "jcode",
    aliases: ["jc", "j"],
    buildArgs: buildJcodeArgs,
    yoloFlag: ["--dangerously-skip-permissions"],
    baseUrlEnv: "OPENAI_BASE_URL",
    apiKeyEnv: "OPENAI_API_KEY",
  },
  {
    name: "kilocode",
    aliases: ["kc", "kilo"],
    buildArgs: buildKilocodeArgs,
    yoloFlag: ["--dangerously-skip-permissions"],
    baseUrlEnv: "OPENAI_BASE_URL",
    apiKeyEnv: "OPENAI_API_KEY",
  },
  {
    name: "opencode",
    aliases: ["oc", "op"],
    buildArgs: buildOpenCodeArgs,
    yoloFlag: ["--dangerously-skip-permissions"],
    baseUrlEnv: "OPENAI_BASE_URL",
    apiKeyEnv: "OPENAI_API_KEY",
  },
];

describe("external adapter arg builders", () => {
  for (const c of CASES) {
    describe(c.name, () => {
      it("passes --model as a positional flag", () => {
        const args = c.buildArgs({ model: "claude-sonnet-5", yolo: false, extraArgs: [] });
        const needle = c.name === "aider" ? "openai/claude-sonnet-5" : "claude-sonnet-5";
        assert.ok(args.includes(needle));
      });

      it("includes the yolo flag only when yolo is true", () => {
        const safe = c.buildArgs({ model: "m", yolo: false, extraArgs: [] });
        for (const f of c.yoloFlag) {
          assert.ok(!safe.includes(f), `${f} should not appear when yolo=false`);
        }

        const yolo = c.buildArgs({ model: "m", yolo: true, extraArgs: [] });
        for (const f of c.yoloFlag) {
          assert.ok(yolo.includes(f), `${f} should appear when yolo=true`);
        }
      });

      it("forwards extra args verbatim", () => {
        const args = c.buildArgs({ model: "m", yolo: false, extraArgs: ["--foo", "bar", "--baz"] });
        assert.ok(args.includes("--foo"));
        assert.ok(args.includes("bar"));
        assert.ok(args.includes("--baz"));
      });

      it("never includes --sandbox in args (refused at adapter level)", () => {
        const args = c.buildArgs({ model: "m", yolo: false, extraArgs: [] });
        assert.ok(!args.includes("--sandbox"));
      });
    });
  }

  it("aider prefixes model with openai/ for its provider scheme", () => {
    const args = buildAiderArgs({ model: "claude-sonnet-5", yolo: false, extraArgs: [] });
    assert.ok(args.includes("openai/claude-sonnet-5"));
  });
});

describe("external adapter CLI routing", () => {
  const DEAD = "http://127.0.0.1:1/v1";

  for (const c of CASES) {
    describe(c.name, () => {
      it("refuses --sandbox with a clear message", () => {
        const r = runIsolated("-a", c.name, "--sandbox", "--gateway", DEAD);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /--sandbox is not supported/);
      });

      it("--print-only prints args and exits 0", () => {
        const r = runIsolated("-a", c.name, "--print-only", "--model", "claude-sonnet-5", "--gateway", DEAD);
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout + r.stderr, /dry run/);
      });
    });
  }
});

describe("external adapter detect", () => {
  it("detect() resolves to a boolean for every adapter", async () => {
    const { aiderAdapter } = await import("../aider.js");
    const { codexAdapter } = await import("../codex.js");
    const { clineAdapter } = await import("../cline.js");
    const { jcodeAdapter } = await import("../jcode.js");
    const { kilocodeAdapter } = await import("../kilocode.js");
    const { opencodeAdapter } = await import("../opencode.js");

    for (const adapter of [
      aiderAdapter, codexAdapter, clineAdapter,
      jcodeAdapter, kilocodeAdapter, opencodeAdapter,
    ]) {
      const result = await adapter.detect();
      assert.equal(typeof result, "boolean", `${adapter.name} detect() must return boolean`);
    }
  });
});
