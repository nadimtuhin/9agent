# Sandbox image for `9agent -a command-code --sandbox`.
# The image tag is a hash of this file, so editing it rebuilds automatically.
FROM node:22-slim

# Debian slim ships none of these, and a coding agent shells out to all of them.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ripgrep jq curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Pinned: a floating version would leave the cache key unchanged while the
# contents drifted. Bump to upgrade.
RUN npm install -g command-code@1.32.2

USER node
WORKDIR /workspace
