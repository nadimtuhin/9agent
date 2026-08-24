import { createHash } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import type { Stats } from "node:fs";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runHost } from "./host.js";

const execFileAsync = promisify(execFile);

/** Hostnames that mean "this machine" and so must be redirected at the host. */
const LOOPBACK = new Set(["localhost", "0.0.0.0", "::1"]); // 127.0.0.0/8 handled by regex

/**
 * Paths under the agent's home that the HOST executes: hooks, plugin code, and the
 * settings/instructions that point at them. They are mounted read-only over the
 * top of the home mount, so an agent in the sandbox cannot write itself a hook
 * that runs outside the sandbox. Without this, `--sandbox` is decorative.
 */
const HOST_EXECUTED_PATHS = [
  "settings.json",
  "settings.local.json",
  "CLAUDE.md",
  "hooks",
  "plugins",
];

/**
 * The same list for hermes, which keeps its host-executed code elsewhere.
 *
 * This was once `[]`, on the comment "the host runs nothing out of ~/.hermes".
 * That was never checked and was false: config.yaml declares
 * `hooks.post_tool_call.command: ~/.hermes/agent-hooks/verify-edit.sh`, and the
 * host runs it after every edit. A sandboxed agent could rewrite that script and
 * get host execution on the next unsandboxed launch.
 *
 * `hermes-agent` is here for a second reason: it is the checkout 9agent builds
 * the sandbox image *from*. Left writable, an agent could edit that Dockerfile
 * and have the host's Docker daemon run it on the next --sandbox launch.
 */
const HERMES_HOST_EXECUTED_PATHS = [
  // config.yaml is deliberately absent: the ShadowConfig already mounts it :ro
  // at the same container path, and Docker rejects a duplicate mount point.
  "agent-hooks",
  "hooks",
  "plugins",
  "skills",
  "agents",
  "bin", // mcp_servers resolve commands like `uvx` through here
  "cron", // jobs.json schedules host-side execution
  "hermes-agent", // the build context for the sandbox image itself
];

/** The name Docker gives the host from inside a container. */
const HOST_ALIAS = "host.docker.internal";

export interface SandboxSpec {
  /** Image repository, e.g. "9agent/claude". The tag is derived from the Dockerfile. */
  repo: string;
  /** Path to the Dockerfile that builds this image. */
  dockerfile: string;
  /** Build context. Defaults to the Dockerfile's directory. */
  buildContext?: string;
  /** Host directory holding the agent's own config, e.g. ~/.claude */
  agentHome: string;
  /** Where that directory is mounted inside the container. */
  containerHome: string;
  /**
   * Container user. `undefined` means don't pass --user at all: hermes' wrapper
   * rejects an arbitrary UID outright and wants HERMES_UID/GID instead, so
   * "which user" is a per-agent contract, not a global convention.
   */
  user?: string;
  /** Where the container expects ~/.gitconfig, which follows $HOME per image. */
  gitconfigTarget: string;
  /**
   * Extra identity for the image tag, for images built from a source tree we do
   * not control. Omit when the Dockerfile alone determines what gets built.
   */
  buildRevision?: () => string;
  /** Env every sandboxed run of this agent needs, e.g. hermes' UID mapping. */
  specEnv?: Record<string, string>;
  /**
   * Paths under agentHome that the HOST executes and so must be re-mounted
   * read-only. Empty for agents whose config the host never runs.
   */
  hostExecutedPaths?: string[];
}

/**
 * Rewrite a gateway URL so a container can reach it on the host.
 *
 *   http://localhost:20128/v1  ->  http://host.docker.internal:20128/v1
 *   https://api.example.com/v1 ->  unchanged
 *
 * Parses rather than string-replaces: a naive s/localhost/.../ would also rewrite
 * a "localhost" appearing in a path or query string.
 */
export function containerizeUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url; // not a URL we understand — leave it alone rather than corrupt it
  }
  // Normalise before comparing: URL keeps IPv6 in brackets, and a trailing dot
  // ("localhost.") is a legal absolute form of the same name.
  const host = parsed.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  const isLoopback = LOOPBACK.has(host) || host.startsWith("127.");
  if (!isLoopback) return url;
  parsed.hostname = HOST_ALIAS;
  return parsed.toString();
}

/**
 * Rewrite every loopback URL in a config file's text so a container can reach it.
 *
 * Deliberately text-level and format-agnostic: it works on JSON and YAML alike,
 * and it only ever touches things that parse as URLs. The 9pi wrapper used
 * `sed s/localhost:20128/.../`, which misses the `127.0.0.1` spelling that the
 * hermes config actually uses.
 */
export function containerizeConfigText(text: string): string {
  // The delimiter class must include every character that can *close* a URL in
  // YAML, JSON, or Markdown. Omitting the backtick swallowed it into the
  // hostname and re-emitted it percent-encoded, corrupting the line.
  return text.replace(/https?:\/\/[^\s"',}\]>)`<]+/g, (url) => containerizeUrl(url));
}

/**
 * Where a ShadowConfig lives: a stable derived path, not a temp dir.
 *
 * Stable means it is overwritten in place each run, so there is nothing to clean
 * up on crash or SIGKILL — the alternative needs handlers on four signals and
 * still leaks. Treat it like the image cache: derived, disposable, regenerated.
 */
export function shadowConfigDir(agent: string): string {
  return join(homedir(), ".cache", "9agent", "sandbox", agent);
}

/**
 * Write a rewritten copy of a config file and return its path.
 * The original is only ever read.
 */
export function writeShadowConfig(
  agent: string,
  relativeName: string,
  sourcePath: string,
): string {
  const target = join(shadowConfigDir(agent), relativeName);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  // Inherit the source's mode. These files carry provider API keys, and the
  // default umask turned a user's 0640 config into a world-readable 0644 copy.
  writeFileSync(target, containerizeConfigText(readFileSync(sourcePath, "utf-8")), {
    encoding: "utf-8",
    mode: statSync(sourcePath).mode & 0o777,
  });
  return target;
}

/** The tag is the Dockerfile's content hash, so an edit rebuilds automatically. */
export function imageTag(dockerfileContents: string): string {
  return createHash("sha256").update(dockerfileContents).digest("hex").slice(0, 12);
}

/**
 * Build the full `docker run` argv.
 *
 * Pure so it can be unit-tested and printed by --print-only without spawning.
 * Note the agent command is passed as argv, never as a `sh -c` string — that is
 * what removes the wrappers' arg-splitting and shell-injection bug.
 */
export function buildSandboxArgs(opts: {
  image: string;
  spec: SandboxSpec;
  bin: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  tty: boolean;
  gitconfig?: string;
  /** Subset of HOST_EXECUTED_PATHS that exists on this machine. */
  readOnlyPaths?: string[];
  /** Ready-made "src:dst[:opts]" mounts, e.g. a ShadowConfig. */
  extraMounts?: string[];
}): string[] {
  const {
    image, spec, bin, args, env, cwd, tty, gitconfig,
    readOnlyPaths = [], extraMounts = [],
  } = opts;
  return [
    "run",
    "--rm",
    // tini: forwards signals and reaps orphans, so the agent is not PID 1 with
    // no default SIGTERM handler. This is what makes the exit contract hold.
    "--init",
    ...(tty ? ["-it"] : ["-i"]),
    ...(spec.user ? ["--user", spec.user] : []),
    // Always explicit: host.docker.internal resolves without this on OrbStack and
    // Docker Desktop, but not on plain Linux Docker.
    "--add-host",
    `${HOST_ALIAS}:host-gateway`,
    "-v",
    `${cwd}:/workspace`,
    "-v",
    `${spec.agentHome}:${spec.containerHome}`,
    // Nested read-only mounts land on top of the home mount above, so order matters.
    ...readOnlyPaths.flatMap((rel) => [
      "-v",
      `${join(spec.agentHome, rel)}:${spec.containerHome}/${rel}:ro`,
    ]),
    ...extraMounts.flatMap((m) => ["-v", m]),
    ...(gitconfig ? ["-v", `${gitconfig}:${spec.gitconfigTarget}:ro`] : []),
    "-w",
    "/workspace",
    ...Object.entries({ ...spec.specEnv, ...env }).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    image,
    bin,
    ...args,
  ];
}

function dockerfilePath(name: string): string {
  // Resolves in both dist/ and src/ layouts: docker/ sits at the package root.
  return join(fileURLToPath(new URL("../..", import.meta.url)), "docker", name);
}

export function claudeSpec(): SandboxSpec {
  return {
    repo: "9agent/claude",
    // Opt-in escape hatch: the root variant adds passwordless sudo, which the
    // default image deliberately lacks. Its tag differs because the tag is a
    // hash of the Dockerfile, so the two images never collide.
    dockerfile: dockerfilePath(
      process.env.NINEAGENT_SANDBOX_ROOT ? "claude-root.Dockerfile" : "claude.Dockerfile",
    ),
    agentHome: join(homedir(), ".claude"),
    containerHome: "/home/node/.claude",
    user: "node",
    gitconfigTarget: "/home/node/.gitconfig",
    hostExecutedPaths: HOST_EXECUTED_PATHS,
  };
}

export function piSpec(): SandboxSpec {
  return {
    repo: "9agent/pi",
    dockerfile: dockerfilePath("pi.Dockerfile"),
    agentHome: join(homedir(), ".pi"),
    containerHome: "/home/node/.pi",
    user: "node",
    gitconfigTarget: "/home/node/.gitconfig",
    hostExecutedPaths: HOST_EXECUTED_PATHS,
  };
}

/** Where hermes' own checkout lives; it ships the only Dockerfile that can build it. */
export function hermesCheckout(): string {
  return join(homedir(), ".hermes", "hermes-agent");
}

/**
 * Hermes does not fit the node-image convention, and cannot be made to.
 *
 * Upstream refuses pip/wheel installs, so we build *their* image from *their*
 * checkout rather than writing a Dockerfile of our own. That image then imposes
 * two things their `main-wrapper.sh` enforces: `--user <arbitrary uid>` is a
 * hard error (pass HERMES_UID/GID instead), and $HOME inside the container is
 * /opt/data, not /home/node. `--init` is explicitly supported — their
 * entrypoint dispatcher detects a non-PID-1 start and skips s6-overlay.
 */
export function hermesSpec(): SandboxSpec {
  const checkout = hermesCheckout();
  return {
    repo: "9agent/hermes",
    dockerfile: join(checkout, "Dockerfile"),
    buildContext: checkout,
    buildRevision: () => gitRevision(checkout),
    agentHome: join(homedir(), ".hermes"),
    containerHome: "/opt/data",
    user: undefined, // their wrapper rejects --user; see HERMES_UID below
    gitconfigTarget: "/opt/data/.gitconfig",
    specEnv: {
      HERMES_UID: String(process.getuid?.() ?? 1000),
      HERMES_GID: String(process.getgid?.() ?? 1000),
    },
    hostExecutedPaths: HERMES_HOST_EXECUTED_PATHS,
  };
}

/** The checkout's current commit, or "" when it is not a usable git tree. */
export function gitRevision(dir: string): string {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

export function resolveImage(spec: SandboxSpec): string {
  const contents = readFileSync(spec.dockerfile, "utf-8");
  // For our own images the Dockerfile *is* the identity — it pins the agent
  // version. For an image built from someone else's checkout it is not: they
  // can ship a month of changes without touching it, and the tag would never
  // move, so 9agent would run a frozen image forever with no signal.
  return `${spec.repo}:${imageTag(contents + (spec.buildRevision?.() ?? ""))}`;
}

/** Build the image if this exact Dockerfile has not been built before. */
export async function ensureImage(spec: SandboxSpec, image: string): Promise<void> {
  try {
    await execFileAsync("docker", ["image", "inspect", image]);
    return; // cache hit
  } catch (err) {
    // Distinguish "docker is missing" from "image not built yet" — otherwise the
    // most likely first-run failure surfaces as a raw `spawn docker ENOENT`.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        "9agent: --sandbox needs Docker, but no `docker` command was found. " +
          "Install Docker, or drop --sandbox to run on the host.",
      );
    }
    // not built yet — fall through
  }

  // A silent multi-minute hang is the worst possible first run, so stream the build.
  console.error(`9agent: building sandbox image ${image} (first run)…`);
  await runHost(
    "docker",
    [
      "build",
      "-f",
      spec.dockerfile,
      "-t",
      image,
      spec.buildContext ?? dirname(spec.dockerfile),
    ],
    {},
  );
}

/**
 * Bind the targets of symlinks that point out of the agent's home.
 *
 * A bind mount carries symlinks across verbatim, so `~/.hermes/SOUL.md ->
 * ~/.claude/persona-core.md` arrives in the container as a link to a path that
 * is not mounted. Reads then fail with ENOENT, and an agent that tries to
 * *create* the missing file crashes on it — which is exactly how this was found.
 *
 * Mounted read-only: the target lives outside the sandbox, so the agent may
 * read the config the user linked in, never rewrite it.
 */
export function escapingSymlinkMounts(
  agentHome: string,
  containerHome: string,
  maxDepth = 3,
): string[] {
  let root: string;
  try {
    // Resolve the home too, or the "is it inside?" test compares a resolved
    // target against an unresolved prefix and calls every link an escapee.
    // (/var is a symlink to /private/var on macOS — that is not a corner case.)
    root = realpathSync(agentHome);
  } catch {
    return [];
  }

  // Nested links are the common case, not the exotic one: on this machine every
  // skill in ~/.claude/skills/ is a link out to another agent's tree, while the
  // top level has none at all. A scan that stops at depth 1 finds nothing.
  const walk = (dir: string, relative: string, depth: number): string[] => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return []; // unreadable directory is the user's problem, not a mount
    }
    return names.flatMap((name) => {
      const path = join(dir, name);
      const rel = relative ? `${relative}/${name}` : name;
      let link: Stats;
      try {
        link = lstatSync(path);
      } catch {
        return [];
      }
      // Descend into real directories only. Following a directory *link* would
      // walk back out of the home we are trying to bound.
      if (link.isDirectory()) {
        return depth < maxDepth ? walk(path, rel, depth + 1) : [];
      }
      if (!link.isSymbolicLink()) return [];
      return mountForLink(path, rel, root, containerHome);
    });
  };
  return walk(agentHome, "", 1);
}

function mountForLink(
  path: string,
  rel: string,
  root: string,
  containerHome: string,
): string[] {
  let target: string;
  let targetIsFile: boolean;
  try {
    target = realpathSync(path); // resolves chains; throws on a dangling link
    targetIsFile = statSync(target).isFile();
  } catch {
    return []; // already broken on the host — not ours to fix
  }
  if (target === root || target.startsWith(root + "/")) return [];
  if (target.includes(":")) {
    console.error(`9agent: not mounting ${rel} — its target contains ':'.`);
    return [];
  }
  // A directory link is how this turns from a convenience into a hole: one
  // `ln -s ~/.ssh` written from inside the container, and the *next* run mounts
  // the whole directory. The agent can write its own home, so this list is
  // agent-controlled input. Single files are the documented case (SOUL.md).
  if (!targetIsFile) return [];
  if (isSensitivePath(target)) {
    console.error(`9agent: refusing to mount ${rel} — it points into ${target}.`);
    return [];
  }
  return [`${target}:${containerHome}/${rel}:ro`];
}

/**
 * Paths whose contents are never worth exposing to an Agent, however the link
 * that reaches them got there.
 *
 * This is a backstop, not the main defence: the agent can write inside its own
 * home, so anything derived from that directory is agent-controlled input. The
 * file-only rule above is what closes the hole; this catches the narrower
 * `ln -s ~/.ssh/id_ed25519` that survives it.
 */
export function isSensitivePath(target: string): boolean {
  const home = homedir();
  const denied = [".ssh", ".aws", ".gnupg", ".kube", ".docker", ".config/gh"];
  return denied.some(
    (rel) => target === join(home, rel) || target.startsWith(join(home, rel) + "/"),
  );
}

/**
 * Drop mounts whose container path is already claimed.
 *
 * Docker rejects a duplicate mount target outright ("Duplicate mount point"),
 * so one colliding symlink would take `--sandbox` down entirely — and a
 * sandbox that refuses to start pushes the user to run without one. The
 * already-claimed mount is the deliberate one, so it wins.
 */
export function dropCollidingMounts(mounts: string[], claimed: string[]): string[] {
  const targetOf = (m: string) => m.split(":")[1];
  const taken = new Set(claimed.map(targetOf));
  return mounts.filter((m) => {
    if (!taken.has(targetOf(m))) return true;
    console.error(`9agent: ignoring ${m} — ${targetOf(m)} is already mounted.`);
    return false;
  });
}

export function gitconfigIfPresent(): string | undefined {
  const path = join(homedir(), ".gitconfig");
  return existsSync(path) ? path : undefined;
}

/** Only mount what exists — Docker errors on a bind whose source is missing. */
export function readOnlyPathsIn(
  agentHome: string,
  paths: string[] = HOST_EXECUTED_PATHS,
): string[] {
  return paths.filter((rel) => existsSync(join(agentHome, rel)));
}

/**
 * Refuse to mount a directory so broad that the sandbox stops meaning anything.
 * `cd ~ && 9agent --sandbox` would otherwise hand the container ~/.ssh, ~/.aws,
 * and every other repo — exactly what the README promises it does not.
 */
export function assertMountableCwd(cwd: string): void {
  // Normalise first. The old exact-string check let `/Users` through — the
  // parent of home, so strictly worse than the case it refused — along with the
  // trailing-slash and /private spellings of home itself.
  // Resolve symlinks so /tmp and /private/tmp (macOS) compare equal.
  // When cwd doesn't exist yet, resolve through its parent instead.
  let real: string;
  try {
    real = realpathSync(cwd);
  } catch {
    try {
      real = join(realpathSync(dirname(cwd)), basename(cwd));
    } catch {
      real = cwd;
    }
  }
  let home: string;
  try {
    home = realpathSync(homedir());
  } catch {
    home = homedir();
  }
  const tooBroad = ["/", "/Users", "/home", "/etc", "/var", "/tmp", "/private/tmp", home, dirname(home)];
  // Refusing ~/.anything covers ~/.ssh and ~/.aws without naming them all.
  // Not join(home, ".") — path.join normalises the "." away and that prefix
  // then matches the whole home directory, refusing every project under it.
  const isHomeDotDir = real.startsWith(`${home}/.`);
  if (tooBroad.includes(real) || isHomeDotDir) {
    throw new Error(
      `9agent: refusing to mount ${real} as /workspace — the sandbox would expose your ` +
        `entire home directory (~/.ssh, ~/.aws, every repo). cd into a project first.`,
    );
  }
  // -v is colon-delimited, so a colon in the path silently changes what gets mounted.
  if (cwd.includes(":")) {
    throw new Error(
      `9agent: cannot sandbox a path containing ':' (${cwd}) — Docker uses ':' to ` +
        `separate mount fields, so the mount would resolve to the wrong directory.`,
    );
  }
}

/**
 * Run an agent inside a container.
 *
 * Delegates to runHost so the 128+signum exit contract has exactly one
 * implementation: `docker run` surfaces a signal-killed container as a plain
 * exit code (143 for SIGTERM, 137 for SIGKILL), which runHost already maps.
 */
export async function runSandbox(
  spec: SandboxSpec,
  bin: string,
  args: string[],
  env: Record<string, string>,
  extraMounts: string[] = [],
): Promise<void> {
  const cwd = process.cwd();
  assertMountableCwd(cwd); // before the build, so a bad cwd fails in a second
  const image = resolveImage(spec);
  await ensureImage(spec, image);
  const readOnlyPaths = readOnlyPathsIn(spec.agentHome, spec.hostExecutedPaths);
  const argv = buildSandboxArgs({
    image,
    spec,
    bin,
    args,
    env,
    cwd,
    tty: process.stdin.isTTY && process.stdout.isTTY,
    gitconfig: gitconfigIfPresent(),
    readOnlyPaths,
    // Symlink-derived mounts are guesses; the caller's are deliberate. When
    // both want the same container path, the deliberate one wins.
    extraMounts: [
      ...dropCollidingMounts(
        escapingSymlinkMounts(spec.agentHome, spec.containerHome),
        [
          ...extraMounts,
          ...readOnlyPaths.map((rel) => `x:${spec.containerHome}/${rel}`),
          `x:${spec.gitconfigTarget}`,
        ],
      ),
      ...extraMounts,
    ],
  });
  await runHost("docker", argv, {});
}
