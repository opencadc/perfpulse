# perfpulse

Synthetic probes for the CANFAR Science Platform. You write a plain Python function that
returns numbers. perfpulse runs it on a schedule and pushes the numbers to Prometheus over
OTLP. It ships as one container image and one Helm chart.

## Write a probe

```python
import os
import time
import urllib.request

from perfpulse import perfpulse


@perfpulse
def download_data_from_vault() -> dict[str, float]:
    started = time.monotonic()
    with urllib.request.urlopen(os.environ["VAULT_URL"]) as response:
        size = len(response.read())
    return {"bytes": size, "seconds": time.monotonic() - started}
```

The rules:

- **No parameters.** Environment variables are a probe's only input.
- **Return** a mapping of `str` keys to `int` or `float` values. Nothing else.
- **Naming.** The function name becomes the metric name. Key `k` becomes the gauge
  `<function>_<k>`, so this example writes `download_data_from_vault_bytes` and
  `download_data_from_vault_seconds`.
- **Keys** are lowercase snake_case and end in a base unit (`seconds`, `bytes`, `ratio`,
  `bytes_per_second`) or a plural noun (`files`, `sessions`). Type suffixes (`_total`,
  `_count`, …) and other units (`_ms`, `_gib`, `_percent`) are rejected.
- **To fail, raise.** A failed run reports no values.
- **Clean up** in `finally`. A timeout raises inside the probe, so `finally` still runs, even
  past an `except Exception`.
- Don't start threads or create OpenTelemetry providers at import.

Every run also writes `perfpulse_probe_success` (1 or 0) and
`perfpulse_probe_duration_seconds`. Every series carries `job="<installation>/perfpulse"`
(the perfpulse marker) and `instance="<probe key>"`. Probe series get one sample per run, so
read them with a range function: `last_over_time(x[1h])`.

## Run it

```bash
uv run perfpulse perfpulse.probes.node:cpu_benchmark --dry-run
```

`--dry-run` prints the series instead of pushing them.

| Exit code | Meaning |
|---|---|
| 0 | the probe succeeded and was reported |
| 1 | it failed and the failure was reported |
| 2 | nothing was reported (bad reference or settings, or the push was rejected) |

Settings come from the environment. The chart sets all of them.

| Variable | Meaning |
|---|---|
| `PERFPULSE_INSTALLATION` | installation id, becomes `service.namespace` (required) |
| `PERFPULSE_PROBE` | probe key, becomes `instance` (default: the function name) |
| `PERFPULSE_TIMEOUT` | seconds before the probe is stopped and reported failed (default 300) |
| `PERFPULSE_NODE` | node name, added as a `node` label by node probes |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | the Prometheus OTLP receiver base, e.g. `http://prometheus-operated.monitoring.svc:9090/api/v1/otlp` |

## Deploy it

Install one release per installation, in that installation's system namespace. Each entry
under `probes` becomes one CronJob. See [`chart/values.yaml`](chart/values.yaml).

```yaml
installation: canfar-skaha-prod
authSecret: perfpulse-auth          # holds CANFAR_TOKEN
env: {SKAHA_URL: https://ws-uv.canfar.net/skaha/v1}
workload: {namespace: canfar-workloads, queue: cadc-default, arcClaim: canfar-workloads-production-pvc}
probes:
  spawn-notebook: {function: perfpulse.probes.skaha:spawn_session, schedule: "*/10 * * * *", timeout: 900,
                   env: {SESSION_TYPE: notebook, SESSION_IMAGE: "images.canfar.net/skaha/<notebook>:<tag>"}}
  arc-copy:       {function: perfpulse.probes.storage:arc_scratch_copy, schedule: "17 * * * *", workload: true,
                   env: {ARC_DIR: /arc/projects/perfpulse}}
  disk-bench:     {function: perfpulse.probes.node:disk_benchmark, schedule: "0 3 * * *", workload: true, nodes: 12}
```

`workload: true` probes run in the session namespace through Kueue, with /arc mounted the way
sessions mount it.

Probes kept in another repository ship as an image built `FROM` the perfpulse image, with the
probe modules copied into `/probes`, which is on `PYTHONPATH`.

## Built-in probes

| Function | Measures |
|---|---|
| `perfpulse.probes.skaha:spawn_session` | session create, Running and ready time (a notebook is ready when its URL answers), and leftover sessions swept |
| `perfpulse.probes.storage:vospace_listing` | storage API listing time for /home and /projects |
| `perfpulse.probes.storage:arc_scratch_copy` | /arc ↔ scratch copies: 100 × 1 KB and 1 × 1 GB, both ways |
| `perfpulse.probes.storage:arc_usage` | bytes and files under /arc home and projects, and filesystem fill |
| `perfpulse.probes.node:cpu_benchmark` | single-core sha256 throughput |
| `perfpulse.probes.node:disk_benchmark` | scratch disk write and read throughput |

## Develop

```bash
uv sync
uv run ruff check src tests
uv run pytest
```
