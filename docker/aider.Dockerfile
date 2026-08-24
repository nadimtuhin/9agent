# Sandbox image for `9agent -a aider --sandbox`.
# The image tag is a hash of this file, so editing it rebuilds automatically.
FROM python:3.12-slim

# Debian slim ships none of these, and a coding agent shells out to all of them.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ripgrep jq curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Pinned: a floating version would leave the cache key unchanged while the
# contents drifted. Bump to upgrade.
RUN pip install --no-cache-dir aider-chat==0.86.2

RUN useradd -m -u 1000 agent
USER agent
WORKDIR /workspace
