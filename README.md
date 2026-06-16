# PerfPulse

In-cluster k6 workload runner for CANFAR performance evidence. See [CONTEXT.md](./CONTEXT.md) for
domain language and [docs/](./docs/) for runbooks and ADRs.

Local development: `bun run check`.

## Skaha workload image (`stress-ng`)

Skaha sessions use `images.canfar.net/skaha/stress-ng:latest` (Ubuntu + `stress-ng` only). The
image is rebuilt manually when needed; charts reference the `:latest` tag.

Dockerfile: [docker/stress-ng/Dockerfile](./docker/stress-ng/Dockerfile)

From the repo root:

```bash
docker login images.canfar.net

docker build \
  --platform linux/amd64,linux/arm64 \
  --tag images.canfar.net/skaha/stress-ng:latest \
  -f docker/stress-ng/Dockerfile \
  .

docker push images.canfar.net/skaha/stress-ng:latest
```

Quick check under the fixed workload footprint (1 CPU, 1 GiB):

```bash
docker run --rm --platform linux/amd64 --cpus 1 --memory 1g --memory-swap 1g \
  images.canfar.net/skaha/stress-ng:latest \
  --cpu 1 --temp-path /tmp --timeout 5s --metrics-brief
```
