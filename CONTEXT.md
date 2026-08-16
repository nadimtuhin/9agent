# CONTEXT — 9agent domain glossary

9agent is `9claude`/`9pi` generalised to all agents. This file defines the words
we use. It is a glossary, not documentation: no flags, no file layout, no APIs.

## Agent

A third-party coding CLI product — `claude`, `pi`, `hermes`. We do not build,
version, or configure Agents; we launch them.

*Not* the spawned process (that is a Session). *Not* our code for talking to it
(that is an Adapter).

## Adapter

Our translation layer for exactly one Agent: how to detect it, and how to turn a
Model, a Gateway, and a PermissionMode into the env and flags that Agent expects.
The translation is opaque behind `launch()` — the caller never learns whether an
Agent takes its model via a flag, an env var, or a config file.

*Not* a plugin system, and not user-extensible.

## Session

One spawned run of an Agent. It begins at exec and ends when the child exits;
9agent mirrors its exit code and does nothing else with it.

*Not* something we track, name, resume, supervise, or restart. See ADR-0001.

## Model

An opaque string identifier, as served by the Gateway. It is never parsed, split
on `/`, or interpreted — `owned_by` is a display and search label only. Routing
is 9Router's job, not ours.

*Not* a structured provider/name pair, and not a capability descriptor.

## ModelCache

A disposable, on-disk copy of the last successful model list, used only when the
Gateway is unreachable at the transport level. It has no TTL and is never
authoritative. Serving from it is announced, because the list may name models
that no longer exist.

*Not* a catalog, not a source of truth, and not a fallback for an authentication
or protocol failure — a 401 is an error, not offline.

## PermissionMode

Whether the Session may act without asking: `safe` or `dangerous`. A real domain
concept, not a passthrough flag. An Adapter whose Agent cannot honour it must say
so out loud rather than silently accepting the request.

## Gateway

The OpenAI-compatible 9Router endpoint that serves the model list and proxies
inference. Identified by a base URL and an API key.

*Not* a per-agent setting we own. Some Agents read routing from their own config
file; when 9agent's Gateway disagrees with that file, we warn — we never rewrite
a file the user owns.
