# 9agent

[![npm](https://img.shields.io/npm/v/9agent?color=blue)](https://www.npmjs.com/package/9agent)
[![CI](https://img.shields.io/github/actions/workflow/status/nadimtuhin/9agent/ci.yml?branch=main)](https://github.com/nadimtuhin/9agent/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/node/v/9agent)](https://nodejs.org)

One launcher for Claude Code, Pi, and Hermes — pick a model from your gateway,
launch the agent, optionally in Docker.

![9agent picking an agent, a model, and a permission mode](docs/demo.gif)

```bash
npm i -g 9agent
9agent                      # prompts: agent → model → mode
```

```bash
9agent -a claude -m lc/LongCat-2.0 --yolo            # skip the prompts
9agent -a claude -m lc/LongCat-2.0 --yes safe --sandbox   # ...and run it in Docker
```

## Requirements

| Need | Why |
|------|-----|
| Node >= 20 | `fetch`, `import.meta` |
| A gateway serving `GET /v1/models` | Where the model list comes from. Built for [9Router](https://github.com/nadimtuhin/9router); anything OpenAI-compatible works |
| One of `claude`, `pi`, `hermes` | 9agent launches these, it doesn't bundle them |
| Docker | Only for `--sandbox` |

No gateway? You get `Is 9Router running?` and exit 1 — never a hang.

## Flags

| Flag | Description | Default |
|------|-------------|---------|
| `-a, --agent <name>` | `claude`\|`pi`\|`hermes`, or alias `c`/`cc`/`p`/`h` | picker |
| `-m, --model <id>` | Model id | searchable picker |
| `--sandbox` | Run the agent in Docker | host |
| `--yolo` | Skip permission prompts | safe |
| `--yes <mode>` | Non-interactive: `safe`\|`dangerous` | — |
| `--gateway <url>` | Gateway base URL | `http://localhost:20128/v1` |
| `--key <token>` | Gateway key. `sk_9router` is a local placeholder, not a credential | `$NINEROUTER_KEY`, else `$LOCAL_9ROUTER_KEY`, else `sk_9router` |
| `--print-only` | Print the resolved env + argv, spawn nothing | — |
| `-V, --version` | Print version | — |

`NINEROUTER_URL` and `NINEROUTER_KEY` set the last two. `LOCAL_9ROUTER_KEY`
is also read for the key, after `NINEROUTER_KEY` — a sandboxed agent reaches
the gateway as a remote client, so the `sk_9router` placeholder is rejected
and a real key is required.

Anything after `--` goes to the agent verbatim:

```bash
9agent -a claude -m lc/LongCat-2.0 --yes safe -- --verbose
```

## Agents

| Agent | `--yolo` becomes | Gateway routing |
|-------|------------------|-----------------|
| **Claude Code** | `--dangerously-skip-permissions` | env vars |
| **Pi** | nothing — Pi has no permission system | `~/.pi/agent/models.json` |
| **Hermes** | `--yolo` | `9router` provider in `~/.hermes/config.yaml` |

Pi and Hermes have no env var for the base URL, so the gateway must already be in
their config. 9agent reads those files; it never writes them.

For Hermes, `--safe-mode` is *not* the opposite of `--yolo` — it disables
customizations. Safe mode is simply omitting `--yolo`.

## Sandbox

```bash
9agent -a claude -m lc/LongCat-2.0 --yes safe --sandbox
```

Works for all three agents; each gets its own image, built on first use and
cached. The tag is a content hash, so editing a Dockerfile rebuilds
automatically — no version to bump, no stale-image trap.

**Config-driven agents get a ShadowConfig.** Pi and Hermes route through a config
file, so 9agent writes a rewritten *copy* under `~/.cache/9agent/sandbox/` whose
gateway points at the container host, and mounts that read-only. Your file is
opened for reading and never for writing ([ADR-0001](docs/adr/0001-launcher-not-session-manager.md)).

**Hermes builds differently.** Upstream refuses pip and wheel installs, so 9agent
builds *their* image from *your* checkout at `~/.hermes/hermes-agent` — several
minutes the first time. Missing checkout is an error, never a silent unsandboxed
run. Their container contract also differs: no `--user` (their wrapper rejects an
arbitrary UID and takes `HERMES_UID`/`HERMES_GID`), `$HOME` is `/opt/data`, and it
runs as root inside itself where claude and pi run as `node`.

### What it protects

**A blast-radius limiter, not a security boundary against a hostile agent.**

| Protected | How |
|-----------|-----|
| The rest of your filesystem | Only cwd + the agent home are mounted. Refuses to start if cwd is `/`, `/Users`, `$HOME`, or a dotfile dir like `~/.ssh` |
| Host-executed code | Hooks, plugins, skills, and the settings pointing at them are mounted **read-only**, so the agent can't write itself a hook that runs on your host later |
| Global system state | `npm i -g`, `apt` — discarded on exit |
| Host processes | Can't signal or inspect them |

| Not protected | Why |
|---------------|-----|
| Your working directory | Read-write by design; a sandbox that can't edit your code is useless |
| The rest of the agent home | Read-write, and it holds OAuth tokens and history |
| The network | Full outbound, including host loopback |
| The gateway key | Passed as an env var |

Setting `NINEAGENT_SANDBOX_ROOT=1` builds a variant image with passwordless
`sudo` (`docker/claude-root.Dockerfile`, claude only). It is a deliberate hole
in everything above — use it only when an agent must install packages
mid-session, and prefer adding them to the Dockerfile, since runtime installs
are discarded on exit anyway.

Read-only per agent — claude/pi: `settings.json`, `settings.local.json`,
`CLAUDE.md`, `hooks/`, `plugins/`. Hermes: `agent-hooks/`, `hooks/`, `plugins/`,
`skills/`, `agents/`, `bin/`, `cron/`, `hermes-agent/`, and `config.yaml` via the
ShadowConfig. `hermes-agent/` is on that list because it is the checkout the image
is *built from* — writable, the agent could edit a Dockerfile your host then runs.

**Symlinks leaving the agent home** are bind-mounted read-only so they don't
arrive dangling. Only single files cross — never a directory, never into `~/.ssh`,
`~/.aws`, `~/.gnupg`, `~/.kube`, or `~/.docker`. The agent can write its own home,
which makes that list attacker-controlled input; hence the narrow rule.

### Known limits

- Exit codes **125–127** are ambiguous under Docker, which uses them for its own
  failures. Everything else, signals included (`128 + signum`), passes through.
- Agent versions are pinned in `docker/*.Dockerfile`; bump to upgrade. Hermes is
  the exception — its tag follows your checkout's commit.
- Hooks from your host `settings.json` are attempted inside the container. Ones
  pointing at host binaries fail with `not found` — noisy, harmless.
- Verified on macOS (OrbStack / Docker Desktop). On Linux a host UID other than
  1000 may produce wrong ownership — untested, so unclaimed.

## Design

9agent **resolves a model, execs the agent, and mirrors its exit code.** It is not
a session manager and not a config broker. Two rules follow:

- **Never rewrites a config file you own** — config-driven agents get a
  ShadowConfig copy instead.
- **Never supervises what it starts** — no wrapping, no proxying, no restarts, so
  exit codes and signals are the agent's own.

[CONTEXT.md](CONTEXT.md) is the vocabulary.
[ADR-0001](docs/adr/0001-launcher-not-session-manager.md) records what this trades away.

## Adding an adapter

```typescript
export const myAdapter: AgentAdapter = {
  name: "my-agent",
  aliases: ["ma"],
  supportsSandbox: true,          // omit and --sandbox is refused, not ignored
  async detect() { return /* boolean */; },
  async launch(opts: LaunchOptions) { /* spawn it */ },
};
```

Push it to `REGISTRY` in `src/index.ts`. `supportsSandbox` defaults to refusing on
purpose: silently running unsandboxed when someone asked for `--sandbox` is the
dangerous failure. Set `sandboxRefusal` to say why if it can't.

To give it a sandbox, add a `SandboxSpec` in `src/runner/sandbox.ts` — which user
to run as (or none), where `$HOME` is, which paths the host executes.

## Development

```bash
npm install
npm run dev          # tsx
npm run check        # typecheck, build, unit tests
npm run test:docker  # integration harness (needs Docker)
npm run release      # gate, build, verify the tarball, publish
```

## Contributing

Issues and pull requests welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
Release history is in the [changelog](CHANGELOG.md).

## License

MIT — see [LICENSE](LICENSE).
