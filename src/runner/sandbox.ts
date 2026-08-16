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
const LOOPBACK = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

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
  if (!LOOPBACK.has(parsed.hostname)) return url;
  // Swap the hostname only inside the authority ("127.0.0.1:20128"), so the rest
  // of the URL is returned byte-for-byte — no normalisation surprises.
  const authority = parsed.host;
  return url.replace(authority, authority.replace(parsed.hostname, HOST_ALIAS));
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
}): string[] {
  const { image, spec, bin, args, env, cwd, tty, gitconfig } = opts;
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
  const image = resolveImage(spec);
  await ensureImage(spec, image);
  const argv = buildSandboxArgs({
    image,
    spec,
    bin,
    args,
    env,
    cwd: process.cwd(),
    tty: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    gitconfig: gitconfigIfPresent(),
  });
  await runHost("docker", argv, {});
}
