# Sandbox image for `9agent -a claude --sandbox`.
# Committed rather than generated: this file is a security claim, so it should be
# reviewable in the repo and in the published tarball.
#
# The image tag is a hash of this file's contents, so editing it triggers a
# rebuild on the next sandboxed launch. No manual version bumping.
FROM node:22-slim

# Debian slim ships none of these, and a coding agent shells out to all of them.
# The 9pi wrapper tried to solve this by bind-mounting /opt/homebrew/bin, which
# cannot work: those are Mach-O arm64 binaries symlinked into ../Cellar.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ripgrep jq curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install as root into the global prefix, then drop privileges. This is what lets
# us skip the wrappers' NPM_CONFIG_PREFIX=/tmp/.npm-global + PATH juggling.
RUN npm install -g @anthropic-ai/claude-code

USER node
WORKDIR /workspace
