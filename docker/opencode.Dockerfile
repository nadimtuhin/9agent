# Sandbox image for `9agent -a opencode --sandbox`.
# The image tag is a hash of this file, so editing it rebuilds automatically.
FROM node:22-slim

# Debian slim ships none of these, and a coding agent shells out to all of them.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ripgrep jq curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Pinned: a floating version would leave the cache key unchanged while the
# contents drifted. Bump to upgrade.
RUN npm install -g opencode-ai@1.18.22

# Bind-mount targets get their missing parents created by Docker as root inside
# the VM; opencode then cannot write XDG siblings (~/.local/state) or its
# first-run .gitignore next to the config. Pre-own every directory it touches,
# plus the neutral slot the shadow config mounts into (OPENCODE_CONFIG).
RUN mkdir -p /home/node/.local/share /home/node/.local/state \
    /home/node/.config/opencode /run/9agent \
  && chown -R node:node /home/node

USER node
WORKDIR /workspace
