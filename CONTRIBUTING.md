# Contributing

## Before you write code

Two documents decide whether a change belongs here, and both are short:

- **[ADR-0001](docs/adr/0001-launcher-not-session-manager.md)** — 9agent resolves
  a model, execs the agent, and mirrors its exit code. Session tracking,
  supervision, and writing config files the user owns are rejected by design, not
  by oversight. A PR adding one of those needs to argue with the ADR first.
- **[CONTEXT.md](CONTEXT.md)** — the glossary. Agent, Adapter, Session, Model,
  Gateway, and ShadowConfig have exact meanings. Using them loosely in code or in
  a PR description is the fastest way to make a review go in circles.

## The gate

```bash
npm install
npm run check        # typecheck, build, unit tests — must be 0 failures
```

`npm run check` is the definition of done. It typechecks source *and* tests,
builds for real rather than with `--noEmit` (a stale `dist/` once passed a
`--noEmit` run), and asserts the test suite is still being typechecked at all.

```bash
npm run dev          # run from source via tsx
npm test             # unit tests alone
npm run test:docker  # sandbox integration harness, needs Docker
```

The Docker harness is not part of `npm run check` because it is slow. Run it
yourself for any change under `src/runner/` or `docker/`.

## What a good change looks like

- **Adapters** — see *Adding an adapter* in the [README](README.md#adding-an-adapter).
  `supportsSandbox` defaults to refusing on purpose: silently running unsandboxed
  when someone asked for `--sandbox` is the dangerous failure.
- **Dockerfiles** — an image tag is a hash of its Dockerfile, so any edit rebuilds
  automatically. Keep agent versions pinned; a floating version means the cache key
  never changes while the contents silently do.
- **Comments explain why.** The invariant, the trap that was hit, the thing the
  next reader would otherwise undo. Not what the line does.
- **Commits are [conventional](https://www.conventionalcommits.org/)** —
  `fix:`, `feat:`, `docs:`, `chore:`, with a body saying what broke and why.

## Reporting a bug

Open an issue with the output of `9agent --version`, which agent, and whether it
was on the host or under `--sandbox`. **Never paste `--key` or the contents of
`NINEROUTER_KEY`** — a gateway key is a credential.

## License

Contributions are MIT, same as the project.
