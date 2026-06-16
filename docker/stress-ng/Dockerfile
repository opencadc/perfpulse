# Minimal Skaha workload image: Ubuntu + stress-ng only.
# Publish to images.canfar.net/skaha/stress-ng:latest (see README).
# Skaha headless sessions use this image for init containers (/bin/sh) and the main workload.
FROM ubuntu:24.04

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    stress-ng \
  && rm -rf /var/lib/apt/lists/*

ENTRYPOINT ["stress-ng"]
CMD ["--help"]
