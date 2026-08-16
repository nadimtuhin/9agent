# ADR-0001: 9agent is a launcher, not a session manager

Status: accepted

## Context

9agent generalises the `9claude` and `9pi` shell functions to every agent CLI.
Those functions do three things: resolve a model, export env/flags, and `exec`
the agent. Once 9agent became a real program rather than a shell function, two
larger identities became available and were seriously considered:

- **Session manager** — track spawned agents, name them, restart them, supervise
  them, offer `9agent list` / `9agent attach`.
- **Config broker** — own `models.json`, `~/.hermes/config.yaml`, and the
  provider blocks inside them, keeping every agent's routing in sync.

Both are plausible. Both are also one-way doors: users build habits around
process names and config ownership, and taking either back later breaks them.

## Decision

9agent resolves, execs, and mirrors the child's exit code. Nothing else.

It does not track sessions, and it does not write configuration files the user
owns. Where an agent's routing lives in its own config file and 9agent's
`--gateway` disagrees, 9agent warns and proceeds.

## Consequences

- No process supervision, no session registry, no `attach`. A future reader
  looking for them should stop here: their absence is deliberate.
- Exit codes must be exact, because they are the entire output contract. A
  signal reports `128 + signum`, not an approximation.
- Config drift between agents is the user's to fix. 9agent's job is to make the
  drift visible, which is why mismatches warn loudly instead of self-healing.
- The `9claude`/`9pi` wrappers stay. 9agent does not retire them, so parity with
  them is a deliberate, verified constraint rather than an accident.

## Alternatives rejected

**Session manager.** Real value for long-running agents, but it makes 9agent
stateful, gives it a daemon-shaped problem, and duplicates what tmux, cmux, and
the terminal already do well. The launcher can be composed into a session
manager; the reverse is not true.

**Config broker.** Would fix the genuine inconsistency where Hermes uses
`api_key: no-key-needed` while Claude and Pi use `sk_9router`. Rejected because
silently rewriting a user's config is a worse failure than the inconsistency: a
surprising edit to `~/.hermes/config.yaml` is much harder to debug than a warning
telling you the two disagree.
