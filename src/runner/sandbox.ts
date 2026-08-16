import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
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

/** The name Docker gives the host from inside a container. */
const HOST_ALIAS = "host.docker.internal";

export interface SandboxSpec {
  /** Image repository, e.g. "9agent/claude". The tag is derived from the Dockerfile. */
  repo: string;
  /** Path to the Dockerfile that builds this image. */
  dockerfile: string;
  /** Host directory holding the agent's own config, e.g. ~/.claude */
  agentHome: string;
  /** Where that directory is mounted inside the container. */
  containerHome: string;
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
  const isLoopback = LOOPBACK.has(host) || /^127\./.test(host);
  if (!isLoopback) return url;
  parsed.hostname = HOST_ALIAS;
  return parsed.toString();
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
}): string[] {
  const { image, spec, bin, args, env, cwd, tty, gitconfig, readOnlyPaths = [] } = opts;
  return [
    "run",
    "--rm",
    // tini: forwards signals and reaps orphans, so the agent is not PID 1 with
    // no default SIGTERM handler. This is what makes the exit contract hold.
    "--init",
    ...(tty ? ["-it"] : ["-i"]),
    "--user",
    "node",
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
    ...(gitconfig ? ["-v", `${gitconfig}:/home/node/.gitconfig:ro`] : []),
    "-w",
    "/workspace",
    ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
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
    dockerfile: dockerfilePath("claude.Dockerfile"),
    agentHome: join(homedir(), ".claude"),
    containerHome: "/home/node/.claude",
  };
}

export function resolveImage(spec: SandboxSpec): string {
  const contents = readFileSync(spec.dockerfile, "utf-8");
  return `${spec.repo}:${imageTag(contents)}`;
}

/** Build the image if this exact Dockerfile has not been built before. */
export async function ensureImage(spec: SandboxSpec, image: string): Promise<void> {
  try {
    await execFileAsync("docker", ["image", "inspect", image]);
    return; // cache hit
  } catch {
    // not built yet — fall through
  }

  // A silent 60-second hang is the worst possible first run, so stream the build.
  console.error(`9agent: building sandbox image ${image} (first run, ~60s)…`);
  await runHost(
    "docker",
    ["build", "-f", spec.dockerfile, "-t", image, dirname(spec.dockerfile)],
    {},
  );
}

export function gitconfigIfPresent(): string | undefined {
  const path = join(homedir(), ".gitconfig");
  return existsSync(path) ? path : undefined;
}

/** Only mount what exists — Docker errors on a bind whose source is missing. */
export function readOnlyPathsIn(agentHome: string): string[] {
  return HOST_EXECUTED_PATHS.filter((rel) => existsSync(join(agentHome, rel)));
}

/**
 * Refuse to mount a directory so broad that the sandbox stops meaning anything.
 * `cd ~ && 9agent --sandbox` would otherwise hand the container ~/.ssh, ~/.aws,
 * and every other repo — exactly what the README promises it does not.
 */
export function assertMountableCwd(cwd: string): void {
  if (cwd === "/" || cwd === homedir()) {
    throw new Error(
      `9agent: refusing to mount ${cwd} as /workspace — the sandbox would expose your ` +
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
): Promise<void> {
  const cwd = process.cwd();
  assertMountableCwd(cwd); // before the build, so a bad cwd fails in a second
  const image = resolveImage(spec);
  await ensureImage(spec, image);
  const argv = buildSandboxArgs({
    image,
    spec,
    bin,
    args,
    env,
    cwd,
    tty: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    gitconfig: gitconfigIfPresent(),
    readOnlyPaths: readOnlyPathsIn(spec.agentHome),
  });
  await runHost("docker", argv, {});
}
