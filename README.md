# 9agent

[![npm](https://img.shields.io/npm/v/9agent?color=blue)](https://www.npmjs.com/package/9agent)
[![CI](https://img.shields.io/github/actions/workflow/status/nadimtuhin/9agent/ci.yml?branch=main)](https://github.com/nadimtuhin/9agent/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/node/v/9agent)](https://nodejs.org)

One launcher for Claude Code, Pi, and Hermes — pick a model from your gateway,
launch the agent, optionally in Docker.

![9agent picking an agent, searching the gateway model catalog, choosing a permission mode, then launching the agent and printing its reply](docs/demo.gif)

```bash
npm i -g 9agent
9agent                      # prompts: agent → model → mode
```

```bash
9agent -a claude -m ag/gemini-3.7-flash-high --yolo            # skip the prompts
9agent -a claude -m ag/gemini-3.7-flash-high --yes safe --sandbox   # ...and in Docker
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
| `--key <token>` | Gateway key. `sk_9router` is a local placeholder, not a credential | see below |
| `--print-only` | Print the resolved env + argv, spawn nothing | — |
| `-V, --version` | Print version | — |

The gateway URL comes from `--gateway`, else `NINEROUTER_URL`. The key comes
from `--key`, else `NINEROUTER_KEY`, else `LOCAL_9ROUTER_KEY`, else the
`sk_9router` placeholder. `LOCAL_9ROUTER_KEY` exists because a sandboxed agent
reaches the gateway as a remote client, where the placeholder is rejected and a
real key is required.

Anything after `--` goes to the agent verbatim:

```bash
9agent -a claude -m ag/gemini-3.7-flash-high --yes safe -- --verbose
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
9agent -a claude -m ag/gemini-3.7-flash-high --yes safe --sandbox
```

Runs the agent in Docker — a blast-radius limiter, not a security boundary
against a hostile agent. Only cwd and the agent home are mounted, and anything
your host executes (hooks, plugins, settings) is mounted read-only.

[docs/sandbox.md](docs/sandbox.md) has the full threat model, the per-agent
details, and the known limits.

## Design

9agent **resolves a model, execs the agent, and mirrors its exit code.** It is not
a session manager and not a config broker. Two rules follow:

- **Never rewrites a config file you own** — config-driven agents get a
  ShadowConfig copy instead.
- **Never supervises what it starts** — no wrapping, no proxying, no restarts, so
  exit codes and signals are the agent's own.

[CONTEXT.md](CONTEXT.md) is the vocabulary.
[ADR-0001](docs/adr/0001-launcher-not-session-manager.md) records what this trades away.

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
