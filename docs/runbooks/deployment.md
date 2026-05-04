# PerfPulse Deployment Runbook

## M1 manual `spot-direct-tiny`

The repo-managed M1 manifest contract is:

```text
docs/manifests/perfpulse-m1-spot-direct-tiny.yaml
```

Before applying it, replace:

- `images.opencadc.org/platform/perfpulse:TAG` with the published runner image tag.

The checked-in M1 contract sends low-volume k6 metrics directly to the in-cluster Prometheus OTLP
HTTP endpoint at `kube-prometheus-stack-prometheus.monitoring:9090/api/v1/otlp/v1/metrics`.

The manifest creates:

- `canfar-perfpulse` for PerfPulse control resources and k6 `TestRun` resources.
- `canfar-workloads` for workload Jobs created by the runner.
- `perfpulse-runner` service account in `canfar-perfpulse`.
- Workload namespace RBAC for `batch/v1` Job create, list, get, and delete.
- A ConfigMap for non-secret runtime configuration.
- Optional Secret references for OTLP headers/credentials and Skaha credentials.
- A k6 Operator `TestRun` using `/test/perfpulse.js` from the custom runner image.

Apply:

```bash
kubectl apply -f docs/manifests/perfpulse-m1-spot-direct-tiny.yaml
```

The manual M1 `TestRun` uses:

```text
profile: spot-direct-tiny
run class: spot
surface: k8s-direct
control namespace: canfar-perfpulse
workload namespace: canfar-workloads
script.localFile: /test/perfpulse.js
runner image: images.opencadc.org/platform/perfpulse:TAG
arguments: -o opentelemetry
```

OTLP metrics behavior is configured through non-secret ConfigMap values:

```text
K6_OTEL_EXPORTER_PROTOCOL=http/protobuf
K6_OTEL_HTTP_EXPORTER_INSECURE=true
K6_OTEL_HTTP_EXPORTER_ENDPOINT=kube-prometheus-stack-prometheus.monitoring:9090
K6_OTEL_HTTP_EXPORTER_URL_PATH=/api/v1/otlp/v1/metrics
K6_OTEL_METRIC_PREFIX=k6_
K6_OTEL_SERVICE_NAME=perfpulse
K6_OTEL_EXPORT_INTERVAL=5s
```

Keep Skaha tokens, OTLP headers, bearer tokens, and basic-auth material out of the ConfigMap. Put
credentials only in the referenced Secrets.

Direct OTLP to Prometheus is only for M1 and small spot-check volume. Put Collector, Alloy, or
another metrics backend in front of benchmark and stress profiles before running those profiles at
scale.

## Scheduled `spot-tiny`

The repo-managed hourly schedule contract is:

```text
docs/manifests/perfpulse-spot-tiny-hourly.yaml
```

Apply:

```bash
kubectl apply -f docs/manifests/perfpulse-spot-tiny-hourly.yaml
```

The CronJob runs in `canfar-perfpulse`, uses `concurrencyPolicy: Forbid`, and creates one bounded
`spot-tiny` k6 Operator `TestRun` per hour with a generated `testid`:

```text
spot-tiny-YYYYMMDDHHMMSS
```

The checked-in schedule is intentionally hourly:

```text
0 * * * *
```

A 30-minute cadence is a later option only after the hourly production check is stable and
low-risk. Do not schedule benchmark or stress profiles by default; those remain manual operator-run
campaigns.
