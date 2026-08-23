# Opt-in variant of claude.Dockerfile that grants the agent passwordless sudo.
# Selected by setting NINEAGENT_SANDBOX_ROOT=1; the default image never has sudo.
#
# This is a deliberate hole in the sandbox's security claim, kept in its own file
# so the default claim stays true and reviewable. Use it when an agent genuinely
# has to install packages mid-session; prefer adding them to claude.Dockerfile,
# because anything installed at runtime is gone on the next launch.
#
# Root here is root *in the container*, not on the host -- but it is enough to
# undo every hardening step below it, and to leave root-owned files in the
# bind-mounted /workspace, which is your real repo.
#
# Duplicated rather than layered on claude.Dockerfile: that image's tag is a hash
# of its contents, so there is no stable name to FROM. Keep the two in sync.
FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ripgrep jq curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Shared libraries Chromium links against. See claude.Dockerfile for why these
# cannot wait until runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     libnss3 libgbm1 libasound2 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
     libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
     libpango-1.0-0 libcairo2 libatspi2.0-0 \
  && rm -rf /var/lib/apt/lists/*

# The whole point of this file.
RUN apt-get update \
  && apt-get install -y --no-install-recommends sudo \
  && rm -rf /var/lib/apt/lists/* \
  && echo 'node ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/node \
  && chmod 0440 /etc/sudoers.d/node

RUN npm install -g @anthropic-ai/claude-code@2.1.233

USER node
WORKDIR /workspace
