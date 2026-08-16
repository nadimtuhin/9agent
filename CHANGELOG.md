# Changelog

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
