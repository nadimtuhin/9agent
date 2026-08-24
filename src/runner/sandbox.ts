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

const LOOPBACK = new Set(["localhost", "0.0.0.0", "::1"]);

const HOST_EXECUTED_PATHS = [
  "settings.json",
  "settings.local.json",
  "CLAUDE.md",
  "hooks",
  "plugins",
];

const HERMES_HOST_EXECUTED_PATHS = [
  "agent-hooks",
  "hooks",
  "plugins",
  "skills",
  "agents",
  "bin",
  "cron",
  "hermes-agent",
];

const HOST_ALIAS = "host.docker.internal";

export interface SandboxSpec {
  repo: string;
  dockerfile: string;
  buildContext?: string;
  agentHome: string;
  containerHome: string;
  user?: string;
  gitconfigTarget: string;
  buildRevision?: () => string;
  specEnv?: Record<string, string>;
  hostExecutedPaths?: string[];
}

export function containerizeUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  const isLoopback = LOOPBACK.has(host) || host.startsWith("127.");
  if (!isLoopback) return url;
  parsed.hostname = HOST_ALIAS;
  return parsed.toString();
}

export function containerizeConfigText(text: string): string {
  return text.replace(/https?:\/\/[^\s"',}\]>)`<]+/g, (url) => containerizeUrl(url));
}

export function dockerCommand(): string[] {
  const raw = process.env.NINEAGENT_DOCKER_BIN?.trim();
  return raw ? raw.split(/\s+/) : ["docker"];
}

export function shadowConfigDir(agent: string): string {
  return join(homedir(), ".cache", "9agent", "sandbox", agent);
}

export function writeShadowConfig(
  agent: string,
  relativeName: string,
  sourcePath: string,
): string {
  const target = join(shadowConfigDir(agent), relativeName);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  writeFileSync(target, containerizeConfigText(readFileSync(sourcePath, "utf-8")), {
    encoding: "utf-8",
    mode: statSync(sourcePath).mode & 0o777,
  });
  return target;
}

export function imageTag(dockerfileContents: string): string {
  return createHash("sha256").update(dockerfileContents).digest("hex").slice(0, 12);
}

export function buildSandboxArgs(opts: {
  image: string;
  spec: SandboxSpec;
  bin: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  tty: boolean;
  gitconfig?: string;
  readOnlyPaths?: string[];
  extraMounts?: string[];
}): string[] {
  const {
    image, spec, bin, args, env, cwd, tty, gitconfig,
    readOnlyPaths = [], extraMounts = [],
  } = opts;
  return [
    "run",
    "--rm",
    "--init",
    "--memory",
    "4g",
    "--memory-swap",
    "4g",
    "--cpus",
    "2",
    "--pids-limit",
    "256",
    ...(tty ? ["-it"] : ["-i"]),
    ...(spec.user ? ["--user", spec.user] : []),
    "--add-host",
    `${HOST_ALIAS}:host-gateway`,
    "-v",
    `${cwd}:/workspace`,
    "-v",
    `${spec.agentHome}:${spec.containerHome}`,
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
  return join(fileURLToPath(new URL("../..", import.meta.url)), "docker", name);
}

export function claudeSpec(): SandboxSpec {
  return {
    repo: "9agent/claude",
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

export function aiderSpec(): SandboxSpec {
  return {
    repo: "9agent/aider",
    dockerfile: dockerfilePath("aider.Dockerfile"),
    agentHome: join(homedir(), ".aider"),
    containerHome: "/home/agent/.aider",
    user: "agent",
    gitconfigTarget: "/home/agent/.gitconfig",
  };
}

export function opencodeSpec(): SandboxSpec {
  return {
    repo: "9agent/opencode",
    dockerfile: dockerfilePath("opencode.Dockerfile"),
    agentHome: join(homedir(), ".local", "share", "opencode"),
    containerHome: "/home/node/.local/share/opencode",
    user: "node",
    gitconfigTarget: "/home/node/.gitconfig",
  };
}

export function hermesCheckout(): string {
  return join(homedir(), ".hermes", "hermes-agent");
}

export function hermesSpec(): SandboxSpec {
  const checkout = hermesCheckout();
  return {
    repo: "9agent/hermes",
    dockerfile: join(checkout, "Dockerfile"),
    buildContext: checkout,
    buildRevision: () => gitRevision(checkout),
    agentHome: join(homedir(), ".hermes"),
    containerHome: "/opt/data",
    user: undefined,
    gitconfigTarget: "/opt/data/.gitconfig",
    specEnv: {
      HERMES_UID: String(process.getuid?.() ?? 1000),
      HERMES_GID: String(process.getgid?.() ?? 1000),
    },
    hostExecutedPaths: HERMES_HOST_EXECUTED_PATHS,
  };
}

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
  return `${spec.repo}:${imageTag(contents + (spec.buildRevision?.() ?? ""))}`;
}

export async function ensureImage(spec: SandboxSpec, image: string): Promise<void> {
  const [bin, ...prefix] = dockerCommand();
  try {
    await execFileAsync(bin, [...prefix, "image", "inspect", image]);
    return;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        "9agent: --sandbox needs Docker, but no `docker` command was found. " +
          "Install Docker, or drop --sandbox to run on the host.",
      );
    }
  }

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

export function escapingSymlinkMounts(
  agentHome: string,
  containerHome: string,
  maxDepth = 3,
): string[] {
  let root: string;
  try {
    root = realpathSync(agentHome);
  } catch {
    return [];
  }

  const walk = (dir: string, relative: string, depth: number): string[] => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return [];
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
    target = realpathSync(path);
    targetIsFile = statSync(target).isFile();
  } catch {
    return [];
  }
  if (target === root || target.startsWith(root + "/")) return [];
  if (target.includes(":")) {
    console.error(`9agent: not mounting ${rel} — its target contains ':'.`);
    return [];
  }
  if (!targetIsFile) return [];
  if (isSensitivePath(target)) {
    console.error(`9agent: refusing to mount ${rel} — it points into ${target}.`);
    return [];
  }
  return [`${target}:${containerHome}/${rel}:ro`];
}

export function isSensitivePath(target: string): boolean {
  const home = homedir();
  const denied = [".ssh", ".aws", ".gnupg", ".kube", ".docker", ".config/gh"];
  return denied.some(
    (rel) => target === join(home, rel) || target.startsWith(join(home, rel) + "/"),
  );
}

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

export function readOnlyPathsIn(
  agentHome: string,
  paths: string[] = HOST_EXECUTED_PATHS,
): string[] {
  return paths.filter((rel) => existsSync(join(agentHome, rel)));
}

export function assertMountableCwd(cwd: string): void {
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
  const isHomeDotDir = real.startsWith(`${home}/.`);
  if (tooBroad.includes(real) || isHomeDotDir) {
    throw new Error(
      `9agent: refusing to mount ${real} as /workspace — the sandbox would expose your ` +
        `entire home directory (~/.ssh, ~/.aws, every repo). cd into a project first.`,
    );
  }
  if (cwd.includes(":")) {
    throw new Error(
      `9agent: cannot sandbox a path containing ':' (${cwd}) — Docker uses ':' to ` +
        `separate mount fields, so the mount would resolve to the wrong directory.`,
    );
  }
}

export async function runSandbox(
  spec: SandboxSpec,
  bin: string,
  args: string[],
  env: Record<string, string>,
  extraMounts: string[] = [],
): Promise<void> {
  const cwd = process.cwd();
  assertMountableCwd(cwd);
  mkdirSync(spec.agentHome, { recursive: true });
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
  const [dockerBin, ...dockerPrefix] = dockerCommand();
  await runHost(dockerBin, [...dockerPrefix, ...argv], {});
}
