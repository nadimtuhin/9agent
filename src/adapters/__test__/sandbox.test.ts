import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import {
  assertMountableCwd,
  buildSandboxArgs,
  containerizeUrl,
  imageTag,
  type SandboxSpec,
} from "../../runner/sandbox.js";
import { redactSecrets } from "../claude.js";

const SPEC: SandboxSpec = {
  repo: "9agent/claude",
  dockerfile: "/pkg/docker/claude.Dockerfile",
  agentHome: "/home/u/.claude",
  containerHome: "/home/node/.claude",
};

describe("containerizeUrl", () => {
  it("redirects every loopback spelling at the container host", () => {
    assert.equal(
      containerizeUrl("http://localhost:20128/v1"),
      "http://host.docker.internal:20128/v1",
    );
    assert.equal(
      containerizeUrl("http://127.0.0.1:20128/v1"),
      "http://host.docker.internal:20128/v1",
    );
    assert.equal(
      containerizeUrl("http://0.0.0.0:20128/v1"),
      "http://host.docker.internal:20128/v1",
    );
  });

  it("leaves a real remote gateway alone", () => {
    const remote = "https://gw.example.com/v1";
    assert.equal(containerizeUrl(remote), remote);
  });

  it("does not rewrite 'localhost' outside the authority", () => {
    // A regex-based rewrite (what the 9pi wrapper does) corrupts this.
    assert.equal(
      containerizeUrl("https://gw.example.com/proxy/localhost/v1"),
      "https://gw.example.com/proxy/localhost/v1",
    );
  });

  it("returns a non-URL untouched rather than corrupting it", () => {
    assert.equal(containerizeUrl("not a url"), "not a url");
  });

  it("handles loopback spellings the naive form missed", () => {
    // Each of these silently no-op'd when the rewrite was a string .replace().
    assert.equal(containerizeUrl("http://[::1]:20128/v1"), "http://host.docker.internal:20128/v1");
    assert.equal(containerizeUrl("http://LOCALHOST:20128/v1"), "http://host.docker.internal:20128/v1");
    assert.equal(containerizeUrl("http://localhost.:20128/v1"), "http://host.docker.internal:20128/v1");
    assert.equal(containerizeUrl("http://127.1:20128/v1"), "http://host.docker.internal:20128/v1");
    assert.equal(containerizeUrl("http://127.0.0.2:20128/v1"), "http://host.docker.internal:20128/v1");
  });
});

describe("assertMountableCwd", () => {
  it("refuses to mount the whole home directory", () => {
    // `cd ~ && 9agent --sandbox` would hand the container ~/.ssh and every repo.
    assert.throws(() => assertMountableCwd(homedir()), /entire home directory/);
  });
  it("refuses to mount /", () => {
    assert.throws(() => assertMountableCwd("/"), /entire home directory/);
  });
  it("refuses a path containing ':' which would break the -v field split", () => {
    assert.throws(() => assertMountableCwd("/work/od:d"), /contains ':'|containing ':'/);
  });
  it("allows an ordinary project directory", () => {
    assert.doesNotThrow(() => assertMountableCwd("/work/proj"));
  });
});

describe("imageTag", () => {
  it("changes when the Dockerfile changes, so an edit forces a rebuild", () => {
    assert.notEqual(imageTag("FROM node:22-slim"), imageTag("FROM node:23-slim"));
  });
  it("is stable for identical contents", () => {
    assert.equal(imageTag("FROM node:22-slim"), imageTag("FROM node:22-slim"));
  });
});

describe("buildSandboxArgs", () => {
  const base = {
    image: "9agent/claude:abc123",
    spec: SPEC,
    bin: "claude",
    args: ["--dangerously-skip-permissions"],
    env: { ANTHROPIC_BASE_URL: "http://host.docker.internal:20128/v1" },
    cwd: "/work/proj",
    tty: true,
  };

  it("always pins host.docker.internal to the gateway", () => {
    // 9claude omits this and works only because OrbStack/Desktop provide it.
    const argv = buildSandboxArgs(base);
    const i = argv.indexOf("--add-host");
    assert.notEqual(i, -1);
    assert.equal(argv[i + 1], "host.docker.internal:host-gateway");
  });

  it("uses --init so signals are forwarded and orphans reaped", () => {
    assert.ok(buildSandboxArgs(base).includes("--init"));
  });

  it("drops -t when there is no TTY", () => {
    assert.ok(buildSandboxArgs({ ...base, tty: true }).includes("-it"));
    const noTty = buildSandboxArgs({ ...base, tty: false });
    assert.ok(noTty.includes("-i"));
    assert.ok(!noTty.includes("-it"));
  });

  it("passes the agent command as argv, never as a shell string", () => {
    // The wrappers interpolate "$*" into sh -c, which splits and injects.
    const argv = buildSandboxArgs({ ...base, args: ["-p", "hello world; rm -rf /"] });
    assert.ok(!argv.includes("sh"));
    assert.ok(!argv.includes("-c"));
    assert.equal(argv.at(-1), "hello world; rm -rf /");
    assert.equal(argv.at(-3), "claude");
  });

  it("mounts cwd and the agent home, and gitconfig only when present", () => {
    const argv = buildSandboxArgs(base).join(" ");
    assert.match(argv, /-v \/work\/proj:\/workspace/);
    assert.match(argv, /-v \/home\/u\/\.claude:\/home\/node\/\.claude/);
    assert.ok(!argv.includes(".gitconfig"));

    const withGit = buildSandboxArgs({ ...base, gitconfig: "/home/u/.gitconfig" }).join(" ");
    assert.match(withGit, /-v \/home\/u\/\.gitconfig:\/home\/node\/\.gitconfig:ro/);
  });

  it("never bind-mounts host binaries", () => {
    // Mach-O arm64 behind Cellar symlinks cannot execute in a Linux container.
    assert.ok(!buildSandboxArgs(base).join(" ").includes("/opt/homebrew"));
  });

  it("mounts host-executed paths read-only over the home mount", () => {
    // Without this an agent writes ~/.claude/settings.json hooks and gets host
    // code execution on the next unsandboxed run — the sandbox would be decorative.
    const argv = buildSandboxArgs({ ...base, readOnlyPaths: ["settings.json", "hooks"] });
    const joined = argv.join(" ");
    assert.match(joined, /-v \/home\/u\/\.claude\/settings\.json:\/home\/node\/\.claude\/settings\.json:ro/);
    assert.match(joined, /-v \/home\/u\/\.claude\/hooks:\/home\/node\/\.claude\/hooks:ro/);
    // must come AFTER the home mount, or the home mount buries them
    assert.ok(joined.indexOf("/home/node/.claude ") < joined.indexOf("hooks:ro"));
  });

  it("puts the image before the command", () => {
    const argv = buildSandboxArgs(base);
    assert.ok(argv.indexOf("9agent/claude:abc123") < argv.indexOf("claude"));
  });
});

describe("redactSecrets", () => {
  it("keeps the auth token out of --print-only output", () => {
    const safe = redactSecrets({
      ANTHROPIC_AUTH_TOKEN: "sk_9router_supersecret",
      ANTHROPIC_BASE_URL: "http://x/v1",
    });
    assert.ok(!safe.ANTHROPIC_AUTH_TOKEN.includes("supersecret"));
    assert.equal(safe.ANTHROPIC_BASE_URL, "http://x/v1");
  });
});
