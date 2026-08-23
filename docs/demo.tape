# VHS tape for docs/demo.gif -- render with: vhs docs/demo.tape
#
# Records the real picker against a live gateway on :20128.
# Uses --print-only so the recording stops before spawning an agent,
# and so the gateway key prints redacted.

Output docs/demo.gif

Set Shell zsh
Set FontSize 16
Set Width 1000
Set Height 600
Set Padding 20
# ponytail: PlaybackSpeed scales Sleep too, so 1.4 starved every prompt of
# settle time and dropped keystrokes. Record at 1.0; speed up in post if needed.
Set PlaybackSpeed 1.0

# ponytail: run the repo build, not the global `9agent` shim, so the GIF
# always shows current behavior. Swap to `9agent` once the shim tracks main.
Type "node dist/index.js --print-only"
Enter

# First gateway hit is cold (~1.6s) -- without this the picker records empty.
Sleep 3s

# Pick an agent:
Sleep 1s
Down
Sleep 500ms
Up
Sleep 800ms
Enter

# Pick a model: (search over ~109 models)
# ponytail: the search prompt must be mounted before Type, or the first
# keystrokes echo to the raw TTY; and the list must finish re-filtering
# before Enter, or it selects the stale highlighted row (was picking "free").
Sleep 3s
Type "sonnet-4-6"
Sleep 4s
Enter

# Mode:
Sleep 1.5s
Enter

# Resolved env + argv, no spawn.
Sleep 4s
