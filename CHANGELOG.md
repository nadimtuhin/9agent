# Changelog

## 0.6.1 - 2026-08-27

### Fixed

- **Codex adapter ignored custom gateways.** Codex CLI does not read
  `OPENAI_BASE_URL`; the adapter now registers a custom `model_provider` via
  `-c` flags pointing at the gateway, with `wire_api="responses"` since codex
  uses the Responses API.
- **Codex `--full-auto` flag removed upstream.** Replaced with
  `--dangerously-bypass-approvals-and-sandbox`.
- **Update-check cache polluted by tests.** `checkForUpdate()` wrote test
  fixture versions (e.g. `"1.0.0"`) to the real `~/.9agent/update/` cache,
  causing false "update available" notices. Tests now use a tmpdir; cache
  isolated from `.commandcode`.
- **Pre-existing ESM bug in `host.ts`.** `import os from "node:os"` —
  `node:os` has no default export; fixed to `import * as os`.

## 0.4.0 - 2026-08-24

### Added

- **`9agent update`** installs the latest published version (`npm install -g
  9agent@latest`). `--dry-run` prints the command without running it. Typing
  `9agent update` before this release silently forwarded `update` to the agent
  as a passthrough argument, so it looked like a no-op.
- **`9agent doctor`** checks the four things that make a launch fail before it
  starts: the gateway answers `/models`, a key resolved and from which source,
  which agents are installed, and whether the Docker daemon is up for
  `--sandbox`. Exits 1 if any check fails. The key's **source** is named; its
  value is never printed.

### Changed

- **The model catalog is fetched while you pick an agent**, rather than after.
  On a slow gateway the wait now hides inside the time you spend choosing. A
  "Loading models…" hint appears only if the fetch is still in flight, so a fast
  gateway shows nothing at all.

## 0.3.0 - 2026-08-23

### Fixed

- **`--model` was never validated.** The picker only offered ids the gateway
  serves, but an explicit `--model` bypassed that check, so a typo launched the
  agent against a nonexistent model and failed on its first request instead of
  at launch. It now exits 1 with the near-miss ids, or a pointer to the picker.

### Added

- A demo GIF of the agent → model → mode picker in the README, with
  `docs/demo.tape` as reproducible source.
- Contributing and License sections, plus npm/CI/license/node badges.

## 0.2.1 - 2026-08-23

### Security

- **`--help` printed the resolved gateway key.** commander renders an option's
  default value, so once `NINEROUTER_KEY` or `LOCAL_9ROUTER_KEY` was set,
  `9agent --help` echoed a live credential into issue reports, CI logs, and
  screen shares. The key is now resolved after parsing and `--help` names the
  env vars instead. **If you ran 0.2.0 with a key in the environment, rotate
  it.**

### Added

- `LOCAL_9ROUTER_KEY` is read as a key fallback after `NINEROUTER_KEY`. A
  sandboxed agent reaches the gateway through `host.docker.internal`, so 9Router
  sees a remote client and rejects the `sk_9router` placeholder -- `--sandbox`
  looped on 401 until you passed `--key` by hand.
- `NINEAGENT_SANDBOX_ROOT=1` builds a claude image with passwordless `sudo`
  (`docker/claude-root.Dockerfile`). Kept as a separate Dockerfile so the default
  image's security claim stays true and reviewable.

### Fixed

- The claude sandbox image installs the shared libraries Chromium links against.
  Playwright and Puppeteer fetch their own browser binary but not its system
  deps, and the sandbox drops to `USER node` with no root, so there was no way to
  add them at runtime.

## 0.2.0

First published release. 0.1.0 was never on npm.

### Added

- **`--sandbox` runs the agent in a Docker container**, for every agent — claude,
  pi, and hermes. Each gets its own image, built on first use and cached under a
  tag derived from its Dockerfile, so editing the Dockerfile rebuilds
  automatically. See the README's Sandbox section for what it does and does not
  protect.
- **ShadowConfig**: agents that route through a config file (pi's `models.json`,
  hermes' `config.yaml`) are sandboxed by mounting a rewritten *copy* whose
  gateway points at the container host. Your own file is only ever read.
- **hermes adapter** — `hermes chat -m <model> --provider 9router`. Its sandbox
  builds hermes' own image from your checkout at `~/.hermes/hermes-agent`,
  because upstream blocks pip and wheel installs.
- Arbitrary trailing arguments are passed through to the agent, matching the
  `9claude` / `9pi` wrappers.
- `CONTEXT.md` (domain glossary) and `docs/adr/0001-launcher-not-session-manager.md`.

### Fixed

- **A 401 from the gateway was indistinguishable from being offline.** A rotated
  API key silently launched an agent against a months-old model cache. HTTP
  status is now checked outside the `fetch` try, so only a transport failure may
  fall back to cache.
- Malformed JSON and invalid payloads from the gateway are rejected instead of
  poisoning the cache for every later run.
- Exit codes for signal-killed agents are `128 + signum` rather than a hardcoded
  `143`, so an OOM kill no longer looks like a graceful shutdown.
- An unknown `--agent` is rejected instead of silently falling through to the
  picker.
- Serving from cache is announced, per the "cache, not catalog" decision.
- pi warns when the chosen model is absent from `models.json`, where pi would
  otherwise guess its context limits.

### Security

The sandbox is a **blast-radius limiter, not a boundary against a hostile agent**.
Within that scope:

- Paths the host executes out of an agent's home — hooks, plugins, skills, and
  the settings that point at them — are mounted read-only, so a sandboxed agent
  cannot write itself a hook that runs on your host later. This covers hermes'
  `agent-hooks/`, `bin/`, `cron/`, and the `hermes-agent/` checkout the sandbox
  image is built from.
- Symlinks leaving an agent's home are bind-mounted read-only so they do not
  arrive dangling; only single files cross, never directories, and never into
  `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`, or `~/.docker`.
- `--sandbox` refuses to mount `/`, `/Users`, your home directory, or a dotfile
  directory as the workspace.
- ShadowConfig copies inherit the source file's permissions rather than the
  default umask, which had been widening a `0640` secrets file to `0644`.

## 0.1.0

Unreleased. Host-only launcher for claude and pi.
