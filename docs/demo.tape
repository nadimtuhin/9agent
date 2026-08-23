# VHS tape for docs/demo.gif -- render with: vhs docs/demo.tape
#
# Real run against a live gateway on :20128: pick the agent, browse the
# 119-model catalog, pick the mode, launch, and type a prompt into the
# real session.
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
# badges, session warnings) leak into a public GIF. The agent authenticates
# from the env 9agent sets, not from HOME, so this stays a real run.
Env HOME "/tmp/9agent-demo-home"

# Hidden setup: PROMPT_EOL_MARK='' kills zsh's inverse-% partial-line marker
# (the stray glyph in earlier recordings).
Hide
Type "PROMPT_EOL_MARK='' PROMPT='%F{cyan}>%f ' RPROMPT=''"
Enter
Type "cd /Users/nadimtuhin/opensource/9agent"
Enter
Type "clear"
Enter
Show

Type `9agent`
Enter

# First gateway hit is cold (~1.6s) -- without this the picker records empty.
Sleep 3s

# Agent picker: move off claude and back, so the list is visibly a list.
# The picker must be mounted before any arrow key, or Down echoes to the raw
# TTY as ^[[B instead of moving the selection.
Sleep 4s
Down
Sleep 800ms
Up
Sleep 1s
Enter

# Model catalog (~119 models): land unfiltered, scroll, then narrow.
Sleep 2s
Down
Down
Down
Down
Down
Sleep 1500ms
Type "gemini"
Sleep 2500ms
Type "-3.7-flash-high"
# The list must finish re-filtering before Enter, or it selects the stale row.
Sleep 3s
Enter

# Permission mode picker (no --yes, so this is a real prompt now).
Sleep 2s
Enter

# The agent's interactive TUI has to mount before it accepts keystrokes.
Sleep 6s
Type "reply with exactly: hello world"
Sleep 1s
Enter

# Real model call.
Sleep 20s
