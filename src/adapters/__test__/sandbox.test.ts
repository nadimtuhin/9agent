import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertMountableCwd,
  claudeSpec,
  escapingSymlinkMounts,
  hermesCheckout,
  hermesSpec,
  containerizeConfigText,
  piSpec,
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
  user: "node",
  gitconfigTarget: "/home/node/.gitconfig",
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

describe("containerizeConfigText", () => {
  it("rewrites both loopback spellings in one file", () => {
    // The 9pi wrapper used sed on "localhost" and missed the 127.0.0.1 form that
    // the hermes config actually uses for model.base_url.
    const yaml = [
      "base_url: http://localhost:20128/v1",
      "other: http://127.0.0.1:20128/v1",
      "api_key: no-key-needed",
    ].join("\n");
    const out = containerizeConfigText(yaml);
    assert.ok(!out.includes("localhost:20128"));
    assert.ok(!out.includes("127.0.0.1:20128"));
    assert.equal(out.match(/host\.docker\.internal/g)?.length, 2);
    assert.ok(out.includes("api_key: no-key-needed"));
  });

  it("leaves remote URLs and non-URL text alone", () => {
    const json = '{"a":"https://api.example.com/v1","b":"a localhost mention"}';
    assert.equal(containerizeConfigText(json), json);
  });

  it("does not break JSON quoting", () => {
    const json = '{"baseUrl":"http://localhost:20128/v1"}';
    const out = containerizeConfigText(json);
    assert.equal(JSON.parse(out).baseUrl, "http://host.docker.internal:20128/v1");
  });
});

describe("every agent spec", () => {
  it("points at a Dockerfile that exists", () => {
    // Sandbox is for every agent, so every spec must ship its image recipe.
    for (const spec of [claudeSpec(), piSpec()]) {
      assert.ok(existsSync(spec.dockerfile), spec.dockerfile);
    }
  });
  it("gives each agent its own image repo", () => {
    const repos = [claudeSpec(), piSpec(), hermesSpec()].map((s) => s.repo);
    assert.equal(new Set(repos).size, 3);
  });
});

describe("escapingSymlinkMounts", () => {
  // Found the hard way: ~/.hermes/SOUL.md -> ~/.claude/persona-core.md arrived
  // in the container as a dangling link, and hermes crashed writing through it.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "9agent-sym-")));
  const home = join(root, "home");
  const outside = join(root, "outside.md");
  mkdirSync(home);
  writeFileSync(outside, "x");
  writeFileSync(join(home, "real.md"), "x");
  symlinkSync(outside, join(home, "escapes.md"));
  symlinkSync(join(home, "real.md"), join(home, "stays.md"));
  symlinkSync(join(root, "gone.md"), join(home, "dangling.md"));
  const mounts = escapingSymlinkMounts(home, "/opt/data");

  it("binds a symlink whose target leaves the mounted home", () => {
    assert.deepEqual(mounts, [`${outside}:/opt/data/escapes.md:ro`]);
  });
  it("leaves links that stay inside alone — the bind already carries them", () => {
    assert.ok(!mounts.some((m) => m.includes("stays.md")));
  });
  it("ignores a link already broken on the host", () => {
    assert.ok(!mounts.some((m) => m.includes("dangling.md")));
  });
  it("returns nothing when the agent home does not exist", () => {
    assert.deepEqual(escapingSymlinkMounts(join(root, "nope"), "/opt/data"), []);
  });
});

describe("hermesSpec", () => {
  // Their main-wrapper.sh errors out on an arbitrary --user UID and tells you
  // to pass HERMES_UID/GID instead. If these two ever regress the container
  // refuses to start, with a message about NAS UIDs that explains nothing.
  const argv = () =>
    buildSandboxArgs({
      image: "img",
      spec: hermesSpec(),
      bin: "hermes",
      args: [],
      env: {},
      cwd: "/w",
      tty: false,
      gitconfig: "/home/u/.gitconfig",
    });

  it("never passes --user, which upstream rejects outright", () => {
    assert.ok(!argv().includes("--user"));
  });
  it("passes the host UID/GID upstream asks for instead", () => {
    const a = argv();
    assert.ok(a.some((x) => x.startsWith("HERMES_UID=")));
    assert.ok(a.some((x) => x.startsWith("HERMES_GID=")));
  });
  it("mounts config and gitconfig under /opt/data, hermes' $HOME", () => {
    const a = argv();
    assert.ok(a.includes(`${hermesSpec().agentHome}:/opt/data`));
    assert.ok(a.includes("/home/u/.gitconfig:/opt/data/.gitconfig:ro"));
  });
  it("builds from hermes' own checkout, not a Dockerfile we wrote", () => {
    assert.equal(hermesSpec().buildContext, hermesCheckout());
  });
});

describe("imageTag", () => {
  it("changes when the Dockerfile changes, so an edit forces a rebuild", () => {
    assert.notEqual(imageTag("FROM node:22-slim"), imageTag("FROM node:23-slim"));
  });
  it("is stable for identical contents", () => {
    assert.equal(imageTag("FROM node:22-slim"), imageTag("FROM node:22-slim"));
  });
  it("is long enough that the tag is not collision-bait", () => {
    assert.equal(imageTag("x").length, 12);
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
    // Exact argv elements, not a regex over a join: a substring match also passes
    // when an option is appended, so `/workspace:ro` would slip through.
    const argv = buildSandboxArgs(base);
    assert.ok(argv.includes("/work/proj:/workspace"));
    assert.ok(argv.includes("/home/u/.claude:/home/node/.claude"));
    assert.ok(!argv.join(" ").includes(".gitconfig"));

    const withGit = buildSandboxArgs({ ...base, gitconfig: "/home/u/.gitconfig" });
    assert.ok(withGit.includes("/home/u/.gitconfig:/home/node/.gitconfig:ro"));
  });

  it("keeps the workspace writable and the container disposable", () => {
    // A read-only workspace makes the sandbox useless; a missing --rm leaks
    // a container per launch. Both survived mutation before this test existed.
    const argv = buildSandboxArgs(base);
    assert.ok(argv.includes("--rm"));
    assert.ok(!argv.some((a) => a.endsWith("/workspace:ro")));
    const userAt = argv.indexOf("--user");
    assert.notEqual(userAt, -1);
    assert.equal(argv[userAt + 1], "node");
  });

  it("never bind-mounts host binaries", () => {
    // Mach-O arm64 behind Cellar symlinks cannot execute in a Linux container.
    assert.ok(!buildSandboxArgs(base).join(" ").includes("/opt/homebrew"));
  });

  it("adds ShadowConfig mounts read-only", () => {
    const argv = buildSandboxArgs({ ...base, extraMounts: ["/c/models.json:/home/node/.pi/agent/models.json:ro"] });
    assert.ok(argv.includes("/c/models.json:/home/node/.pi/agent/models.json:ro"));
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
