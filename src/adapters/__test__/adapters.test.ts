import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildClaudeEnv, buildClaudeArgs } from "../claude.js";
import { buildCommandCodeArgs, buildCommandCodeEnv } from "../commandcode.js";
import { buildPiArgs } from "../pi.js";
import { buildHermesArgs } from "../hermes.js";

describe("claude adapter: buildClaudeEnv", () => {
  it("maps all required env vars", () => {
    const env = buildClaudeEnv({
      model: "lc/LongCat-2.0",
      baseUrl: "http://localhost:20128/v1",
      apiKey: "sk_9router",
    });
    assert.equal(env.ANTHROPIC_BASE_URL, "http://localhost:20128/v1");
    assert.equal(env.ANTHROPIC_AUTH_TOKEN, "sk_9router");
    assert.equal(env.ANTHROPIC_DEFAULT_OPUS_MODEL, "lc/LongCat-2.0");
    assert.equal(env.ANTHROPIC_DEFAULT_SONNET_MODEL, "lc/LongCat-2.0");
    assert.equal(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, "lc/LongCat-2.0");
    assert.equal(env.CLAUDE_CODE_SUBAGENT_MODEL, "lc/LongCat-2.0");
    assert.equal(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, "1");
  });
});

describe("claude adapter: buildClaudeArgs", () => {
  it("includes --dangerously-skip-permissions when yolo", () => {
    const args = buildClaudeArgs({ yolo: true, extraArgs: ["--verbose"] });
    assert.deepEqual(args, ["--dangerously-skip-permissions", "--verbose"]);
  });
  it("omits --dangerously-skip-permissions when safe", () => {
    const args = buildClaudeArgs({ yolo: false, extraArgs: [] });
    assert.deepEqual(args, []);
  });
});

describe("pi adapter: buildPiArgs", () => {
  it("includes provider and model", () => {
    const args = buildPiArgs({
      model: "lc/LongCat-2.0",
      yolo: false,
      extraArgs: [],
    });
    assert.deepEqual(args, ["--provider", "9router", "--model", "lc/LongCat-2.0"]);
  });
  it("passes through extraArgs", () => {
    const args = buildPiArgs({
      model: "m",
      yolo: false,
      extraArgs: ["--verbose", "--debug"],
    });
    assert.deepEqual(args, [
      "--provider",
      "9router",
      "--model",
      "m",
      "--verbose",
      "--debug",
    ]);
  });
});

describe("hermes adapter: buildHermesArgs", () => {
  it("routes via the 9router provider", () => {
    const args = buildHermesArgs({ model: "lc/LongCat-2.0", yolo: false, extraArgs: [] });
    assert.deepEqual(args, ["chat", "-m", "lc/LongCat-2.0", "--provider", "9router"]);
  });
  it("adds --yolo only in dangerous mode", () => {
    const args = buildHermesArgs({ model: "m", yolo: true, extraArgs: [] });
    assert.deepEqual(args, ["chat", "-m", "m", "--provider", "9router", "--yolo"]);
  });
  it("appends extraArgs after --yolo", () => {
    const args = buildHermesArgs({ model: "m", yolo: true, extraArgs: ["--verbose"] });
    assert.deepEqual(args, [
      "chat",
      "-m",
      "m",
      "--provider",
      "9router",
      "--yolo",
      "--verbose",
    ]);
  });
});

describe("command-code adapter: buildCommandCodeEnv", () => {
  it("sets gateway routing env vars", () => {
    const env = buildCommandCodeEnv({
      baseUrl: "http://localhost:20128/v1",
      apiKey: "sk_9router",
    });
    assert.equal(env.ANTHROPIC_BASE_URL, "http://localhost:20128/v1");
    assert.equal(env.ANTHROPIC_AUTH_TOKEN, "sk_9router");
  });
});

describe("command-code adapter: buildCommandCodeArgs", () => {
  it("passes model via -m flag", () => {
    const args = buildCommandCodeArgs({ model: "lc/LongCat-2.0", yolo: false, extraArgs: [] });
    assert.deepEqual(args, ["-m", "lc/LongCat-2.0"]);
  });
  it("includes --yolo in dangerous mode", () => {
    const args = buildCommandCodeArgs({ model: "m", yolo: true, extraArgs: [] });
    assert.deepEqual(args, ["-m", "m", "--yolo"]);
  });
  it("appends extraArgs after --yolo", () => {
    const args = buildCommandCodeArgs({ model: "m", yolo: true, extraArgs: ["--verbose"] });
    assert.deepEqual(args, ["-m", "m", "--yolo", "--verbose"]);
  });
});
