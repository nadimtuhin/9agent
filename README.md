# 9agent

Universal 9Router agent launcher. Discover models from any OpenAI-compatible `/v1/models` endpoint, pick agent + model + mode interactively, launch.

## Install

```bash
npm i -g 9agent
```

## Usage

Interactive (prompts for agent → model → mode):
```bash
9agent
```

One-liner (skip all prompts):
```bash
9agent -a claude -m lc/LongCat-2.0 --yolo
```

### Passing arguments through to the agent

Anything after `--` goes to the agent verbatim, like `"$@"` in the `9claude`/`9pi`
shell functions:

```bash
9agent -a claude -m lc/LongCat-2.0 --yes safe -- --verbose
```

The `--` is required for agent-bound *flags*; bare words need no separator.
Without it, `9agent` rejects flags it does not recognise rather than guessing
whether they were meant for the agent or for itself.

### Flags

| Flag | Description | Default |
|------|-------------|---------|
| `-a, --agent <name>` | Agent name or alias (`c`, `cc`, `p`, `h`) | interactive picker |
| `-m, --model <id>` | Model ID | interactive search |
| `--yolo` | Skip permissions / dangerous mode | safe |
| `--gateway <url>` | 9Router base URL | `http://localhost:20128/v1` |
| `--key <token>` | 9Router API key | `sk_9router` |
| `--yes <mode>` | Non-interactive: `safe` or `dangerous` | — |
| `--print-only` | Print resolved env+args, don't spawn | — |
| `--sandbox` | Run the agent in a Docker container (claude only) | host |

## Sandbox

`--sandbox` runs the agent inside a container instead of on your host:

```bash
9agent -a claude -m lc/LongCat-2.0 --yes safe --sandbox
```

The image is built on first use (~60s) and cached. Its tag is a hash of
`docker/claude.Dockerfile`, so editing that file rebuilds automatically — there is
no version to bump and no stale-image trap.

**claude only.** `pi` and `hermes` route through their own config files
(`~/.pi/agent/models.json`, `~/.hermes/config.yaml`), which a container cannot be
pointed at the host without editing a file you own — something 9agent does not do
([ADR-0001](docs/adr/0001-launcher-not-session-manager.md)). Both **error** rather
than silently running unsandboxed. Use `9pi --sandbox` in the meantime.

### What the sandbox does and does not protect

It is a **blast-radius limiter, not a security boundary against a hostile agent.**

Protects:
- The rest of your filesystem — a runaway `rm -rf` hits `/workspace` and the
  mounted agent home, not `~/Documents`, `~/.ssh`, or your other repos. 9agent
  **refuses to run** if your cwd is `/` or your home directory, since mounting
  either would make that promise false.
- **Your host's hooks.** `~/.claude/settings.json`, `settings.local.json`,
  `CLAUDE.md`, `hooks/`, and `plugins/` are mounted **read-only**. Without that, an
  agent in the sandbox could write itself a hook that runs on your host the next
  time you start Claude Code — which would make the sandbox decorative.
- Global system state — `npm install -g`, `apt`, and friends are discarded on exit.
- Host process space — the agent cannot signal or inspect host processes.

Does **not** protect:
- **Your working directory.** Mounted read-write by design; a sandbox that cannot
  edit your code is useless.
- **The rest of `~/.claude`.** Mounted read-write, and it holds your OAuth tokens
  and session history. The executable surface above is locked down; the
  credentials are not.
- **The network.** Full outbound access, including your host's loopback — every
  other local service and dev server is reachable.
- **The gateway key.** Passed as an env var, so it is visible to anything that can
  talk to your Docker socket (which is already root-equivalent on the host).

### Known limits

- Exit codes **125–127** are ambiguous in sandbox mode: Docker uses them for its
  own failures, so they cannot be distinguished from an agent that exits 125–127.
  Every other code, including signal deaths (`128 + signum`), passes through exactly.
- The agent version is **pinned in `docker/claude.Dockerfile`**. That is what makes
  the image tag a real content identity — a floating version would leave the cache
  key unchanged while the contents drifted. Bump the pin to upgrade.
- Your host `settings.json` is mounted in, so hooks configured there are attempted
  inside the container. Any that point at a host binary path will fail with
  `not found` on stderr — noisy but harmless, since a missing binary cannot run.
- Verified on macOS (OrbStack/Docker Desktop). On Linux, a host UID other than 1000
  may produce wrong ownership on both `/workspace` and `~/.claude` — untested, so
  unclaimed.

### Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NINEROUTER_URL` | 9Router base URL | `http://localhost:20128/v1` |
| `NINEROUTER_KEY` | 9Router API key | `sk_9router` |

## Agents

| Agent | Status | Notes |
|-------|--------|-------|
| **Claude Code** | ✅ Full | `--yolo` → `--dangerously-skip-permissions` |
| **Pi** | ✅ Full | 9router-only (requires pre-seeded `~/.pi/agent/models.json`) |
| **Hermes** | ✅ Full | 9router-only (requires a `9router` provider in `~/.hermes/config.yaml`) |

### How each adapter translates `--yolo`

- **Claude**: adds `--dangerously-skip-permissions` to args
- **Pi**: no-op (Pi has no built-in permission system)
- **Hermes**: adds `--yolo` (note: `--safe-mode` is *not* the inverse — it disables customizations; safe mode is simply omitting `--yolo`)

### How Pi gateway routing works

Pi reads only provider API keys from environment variables — there is **no env var** to set an arbitrary provider base URL. The gateway must be pre-seeded in `~/.pi/agent/models.json`. If your 9router is already seeded (as with the `9pi` shell function), this just works.

## Adding a 4th adapter

Implement the `AgentAdapter` interface in `src/adapters/` and push to `REGISTRY` in `src/index.ts`:

```typescript
export const myAdapter: AgentAdapter = {
  name: "my-agent",
  aliases: ["ma"],
  async detect() { return /* boolean */; },
  async launch(opts: LaunchOptions) { /* spawn it */ },
};
```

## Development

```bash
npm install
npm run dev        # run with tsx
npm run build      # compile to dist/
node --test --import tsx src/__check.ts   # self-check (needs 9Router)
```

## Status

Host runner, plus Docker `--sandbox` for claude (see [Sandbox](#sandbox)).
