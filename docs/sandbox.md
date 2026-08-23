# Sandbox

```bash
9agent -a claude -m ag/gemini-3.7-flash-high --yes safe --sandbox
```

Works for all three agents; each gets its own image, built on first use and
cached. The tag is a content hash, so editing a Dockerfile rebuilds
automatically — no version to bump, no stale-image trap.

**Config-driven agents get a ShadowConfig.** Pi and Hermes route through a config
file, so 9agent writes a rewritten *copy* under `~/.cache/9agent/sandbox/` whose
gateway points at the container host, and mounts that read-only. Your file is
opened for reading and never for writing ([ADR-0001](adr/0001-launcher-not-session-manager.md)).

**Hermes builds differently.** Upstream refuses pip and wheel installs, so 9agent
builds *their* image from *your* checkout at `~/.hermes/hermes-agent` — several
minutes the first time. Missing checkout is an error, never a silent unsandboxed
run. Their container contract also differs: no `--user` (their wrapper rejects an
arbitrary UID and takes `HERMES_UID`/`HERMES_GID`), `$HOME` is `/opt/data`, and it
runs as root inside itself where claude and pi run as `node`.

## What it protects

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
`sudo` (`../docker/claude-root.Dockerfile`, claude only). It is a deliberate hole
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

## Known limits

- Exit codes **125–127** are ambiguous under Docker, which uses them for its own
  failures. Everything else, signals included (`128 + signum`), passes through.
- Agent versions are pinned in `../docker/*.Dockerfile`; bump to upgrade. Hermes is
  the exception — its tag follows your checkout's commit.
- Hooks from your host `settings.json` are attempted inside the container. Ones
  pointing at host binaries fail with `not found` — noisy, harmless.
- Verified on macOS (OrbStack / Docker Desktop). On Linux a host UID other than
  1000 may produce wrong ownership — untested, so unclaimed.
