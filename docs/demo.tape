# VHS tape for docs/demo.gif -- render from the repo root with:
#   vhs docs/demo.tape
#
# Real run against a live gateway on :20128: pick the agent, browse the model
# catalog, pick the mode, launch, and type a prompt into the real session.
#
# ponytail: no --print-only. The env dump (with the redacted key) only renders
# in the dryRun branch, so a real run prints no token at all.

Output docs/demo.gif

Set Shell zsh
Set FontSize 16
Set Width 1000
Set Height 700
Set Padding 20
# ponytail: PlaybackSpeed scales Sleep too, so >1.0 starves prompts of settle
# time and drops keystrokes. Record at 1.0; speed up in post if needed.
Set PlaybackSpeed 1.0

# Record against a throwaway HOME so no ~/.claude settings (statusline, plugin
# badges) leak into a public GIF. The agent authenticates from the env 9agent
# sets, not from HOME, so this stays a real run.
Env HOME "/tmp/9agent-demo-home"

# Hidden setup, all of it load-bearing:
#   unset CLAUDE_CODE_CHILD_SESSION -- else the agent prints a "transcript
#     saving is off" warning inherited from the recording shell. Setting it
#     empty is not enough; the check is for presence.
#   PROMPT_EOL_MARK='' -- kills zsh's inverse-% partial-line marker.
#   the seed write -- a virgin HOME triggers Claude Code's first-run onboarding
#     splash, which eats the whole recording. Seeded here rather than in a
#     shell command so `vhs docs/demo.tape` alone reproduces the GIF.
#     Version 99.0.0 is deliberate: a version from the future never re-triggers
#     onboarding, where pinning today's breaks on the next release.
#   cd to an empty scratch dir -- recording inside this repo puts its CLAUDE.md
#     in scope, which prompts "Allow external CLAUDE.md file imports?" and
#     lists absolute ~/.claude paths on screen. An empty dir has no CLAUDE.md,
#     so the gate never fires. A fixed /tmp path stays portable; the old
#     `cd /Users/...` did not.
Hide
Type "unset CLAUDE_CODE_CHILD_SESSION"
Enter
Type "PROMPT_EOL_MARK='' PROMPT='%F{cyan}>%f ' RPROMPT=''"
Enter
Type "mkdir -p /tmp/9agent-demo-home && echo eyJoYXNDb21wbGV0ZWRPbmJvYXJkaW5nIjp0cnVlLCJsYXN0T25ib2FyZGluZ1ZlcnNpb24iOiI5OS4wLjAiLCJwcm9qZWN0cyI6eyIvcHJpdmF0ZS90bXAvOWFnZW50LWRlbW8tcmVwbyI6eyJoYXNUcnVzdERpYWxvZ0FjY2VwdGVkIjp0cnVlLCJoYXNDbGF1ZGVNZEV4dGVybmFsSW5jbHVkZXNBcHByb3ZlZCI6dHJ1ZSwiYWxsb3dlZFRvb2xzIjpbXSwiaGlzdG9yeSI6W119LCIvdG1wLzlhZ2VudC1kZW1vLXJlcG8iOnsiaGFzVHJ1c3REaWFsb2dBY2NlcHRlZCI6dHJ1ZSwiaGFzQ2xhdWRlTWRFeHRlcm5hbEluY2x1ZGVzQXBwcm92ZWQiOnRydWUsImFsbG93ZWRUb29scyI6W10sImhpc3RvcnkiOltdfX19 | base64 -d > /tmp/9agent-demo-home/.claude.json"
Enter
Type "mkdir -p /tmp/9agent-demo-repo && cd /tmp/9agent-demo-repo"
Enter
Type "clear"
Enter
Sleep 300ms
Show

Type `9agent`
Enter

# First gateway hit is cold (~1.6s) -- without this the picker records empty.
Sleep 2s

# Agent picker: move off claude and back, so the list is visibly a list.
# RACE GUARD: the picker must be mounted before any arrow key, or Down echoes
# to the raw TTY as a literal ^[[B. Do not go below 3s.
Sleep 3s
Down
Sleep 500ms
Up
Sleep 1s
Enter

# Model catalog: land unfiltered, scroll, then narrow.
Sleep 1s
Down
Down
Down
Down
Down
Sleep 800ms
# Type the provider prefix too. A bare "gemini-3.7-flash-high" substring would
# silently land on a different row if the gateway renames or reorders models --
# a plausible-looking wrong recording is worse than a crash.
Type "ag/gemini"
Sleep 1500ms
Type "-3.7-flash-high"
# RACE GUARD: the list must finish re-filtering before Enter, or it selects the
# stale highlighted row.
Sleep 2s
Enter

# Permission mode picker (no --yes, so this is a real prompt).
Sleep 1s
Enter

# RACE GUARD: the agent's TUI has to mount before it accepts keystrokes.
# ponytail: 5s covers a warm node cache; a cold first run may need 8s. This is
# the sleep to raise if the prompt lands on a half-drawn screen.
Sleep 5s
Type "reply with exactly: hello world"
Sleep 1s
Enter

# Real model call.
Sleep 15s
