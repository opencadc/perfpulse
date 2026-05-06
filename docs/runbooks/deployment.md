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
- `canfar-perfpulse` service account in `canfar-perfpulse`.
- Workload namespace RBAC for `batch/v1` Job create, list, get, and delete.
- A ConfigMap for non-secret runtime configuration.
- Optional Secret references for OTLP headers/credentials and Skaha credentials.
- A k6 Operator `TestRun` using `/test/perfpulse.js` from the custom runner image.
- k6 Operator initializer, runner, and starter pods running as `canfar-perfpulse` with restricted
  pod and container security contexts for production Kyverno admission.
- Runtime workload Jobs created in `canfar-workloads` use restricted pod and container security
  contexts for production Kyverno admission.

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
initializer image: images.opencadc.org/platform/perfpulse:TAG
starter image: operator default curl image
arguments: -o opentelemetry
```

The initializer must use the same custom PerfPulse image as the runner because the script path is
`/test/perfpulse.js`. Keep the starter image unset so the k6 Operator keeps its default curl image;
using the PerfPulse image for starter previously failed with `sh: curl: not found`.

Each k6 Operator pod template uses:

```text
serviceAccountName: canfar-perfpulse
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  runAsGroup: 1000
  seccompProfile:
    type: RuntimeDefault
containerSecurityContext:
  allowPrivilegeEscalation: false
  runAsNonRoot: true
  runAsUser: 1000
  runAsGroup: 1000
  capabilities.drop: [ALL]
  seccompProfile:
    type: RuntimeDefault
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

Keep Skaha bearer tokens, OTLP headers, passwords, and basic-auth material out of the ConfigMap.
Put credentials only in the referenced Secrets.

Direct OTLP to Prometheus is only for M1 and small spot-check volume. Put Collector, Alloy, or
another metrics backend in front of benchmark and stress profiles before running those profiles at
scale.

## Manual `spot-tiny` Direct, Kueue, and Skaha

The repo-managed manual all-surface spot contract is:

```text
docs/manifests/perfpulse-spot-tiny.yaml
```

Before applying it, replace:

- `images.opencadc.org/platform/perfpulse:TAG` with the published runner image tag.

Apply:

```bash
kubectl apply -f docs/manifests/perfpulse-spot-tiny.yaml
```

The manifest creates three k6 Operator `TestRun` resources:

- `perfpulse-spot-tiny-direct`
- `perfpulse-spot-tiny-kueue`
- `perfpulse-spot-tiny-skaha`

All three use `PROFILE=spot-tiny`, `RUN_CLASS=spot`, `CLEANUP=true`,
`VISIBILITY_GATE_SECONDS=60`, `COMPLETION_GATE_SECONDS=120`, and
`K6_OTEL_EXPORT_INTERVAL=1s`. Direct sets `SURFACE=k8s-direct`; Kueue sets
`SURFACE=k8s-kueue`, `KUEUE_QUEUE_NAME=cadc-default`, `KUEUE_PRIORITY_CLASS=low`, and
`KUEUE_ADMISSION_GATE_SECONDS=120`; Skaha sets `SURFACE=skaha` and mounts
`perfpulse-skaha-auth` read-only at `/var/run/secrets/perfpulse/skaha-auth`.

## Manual `benchmark-small` Direct, Kueue, and Skaha

The repo-managed manual Direct, Kueue, and Skaha benchmark contract is:

```text
docs/manifests/perfpulse-benchmark-small-direct-kueue.yaml
```

Before applying it, replace:

- `images.opencadc.org/platform/perfpulse:TAG` with the published runner image tag.

Apply:

```bash
kubectl apply -f docs/manifests/perfpulse-benchmark-small-direct-kueue.yaml
```

The manifest creates three k6 Operator `TestRun` resources:

- `perfpulse-benchmark-small-direct`
- `perfpulse-benchmark-small-kueue`
- `perfpulse-benchmark-small-skaha`

All three use the same operator-provided `TESTID` value, `benchmark-small-manual` in the checked-in
example, so Grafana can compare the Direct, Kueue, and Skaha surfaces by one selected test id after
the benchmark dashboard is available. Change all three `TESTID` values together before applying if
you need a unique manual run id.

Each surface runs `PROFILE=benchmark-small`, `RUN_CLASS=benchmark`, `SCENARIO=many-small-users`,
`TOTAL_JOBS=100`, `LOGICAL_USERS=100`, `PERF_PULSE_CLIENT_MODE=kubernetes`, `CLEANUP=true`,
`K6_OTEL_EXPORT_INTERVAL=1s`, `COMPLETION_GATE_SECONDS=300`, and `VISIBILITY_GATE_SECONDS=120`.

The Direct ConfigMap sets `SURFACE=k8s-direct` and
`K6_OTEL_SERVICE_NAME=perfpulse-benchmark-small-direct`. The Kueue ConfigMap sets
`SURFACE=k8s-kueue`, `K6_OTEL_SERVICE_NAME=perfpulse-benchmark-small-kueue`,
`KUEUE_QUEUE_NAME=cadc-default`, `KUEUE_PRIORITY_CLASS=low`, and
`KUEUE_ADMISSION_GATE_SECONDS=300`. Direct and Kueue also set
`WORKLOAD_NAMESPACE=canfar-workloads`.

The Skaha ConfigMap sets `SURFACE=skaha`,
`K6_OTEL_SERVICE_NAME=perfpulse-benchmark-small-skaha`, the internal staging `SKAHA_API_URL`,
`SKAHA_LOGIN_URL=https://ws-cadc.canfar.net/ac/login`,
`SKAHA_REQUEST_TIMEOUT_SECONDS=120`, `SUBMISSION_STAGGER_SECONDS=1`, and credential file paths under
`/var/run/secrets/perfpulse/skaha-auth`. Direct and Kueue do not set stagger controls, so they retain
their 100-concurrent submission shape. The Skaha `TestRun` mounts the existing
`perfpulse-skaha-auth` Secret read-only at that path. Run `bun run skaha-auth-setup` before applying
if the Secret is not already present.

## Manual `benchmark-medium` Direct, Kueue, and Skaha

The repo-managed medium benchmark contract is:

```text
docs/manifests/perfpulse-benchmark-medium.yaml
```

Apply:

```bash
kubectl apply -f docs/manifests/perfpulse-benchmark-medium.yaml
```

This is a manual operator-run campaign, not a schedule. It creates Direct, Kueue, and Skaha
`TestRun` resources sharing `TESTID=benchmark-medium-manual` in the checked-in example. Each
surface runs `PROFILE=benchmark-medium`, `RUN_CLASS=benchmark`, `SCENARIO=many-small-users`,
`TOTAL_JOBS=1000`, `LOGICAL_USERS=100`, `CLEANUP=true`, `VISIBILITY_GATE_SECONDS=300`,
`COMPLETION_GATE_SECONDS=900`, and `K6_OTEL_EXPORT_INTERVAL=5s`. Kueue additionally sets
`KUEUE_ADMISSION_GATE_SECONDS=900`; Skaha keeps `SUBMISSION_STAGGER_SECONDS=1`.

Benchmark thresholds should stay baseline-free until repeated successful runs establish real
operator-reviewed envelopes.

## Manual stress campaigns

The repo-managed stress contracts are:

```text
docs/manifests/perfpulse-stress-medium.yaml
docs/manifests/perfpulse-stress-high.yaml
```

Apply only in an approved quiet window:

```bash
kubectl apply -f docs/manifests/perfpulse-stress-medium.yaml
kubectl apply -f docs/manifests/perfpulse-stress-high.yaml
```

`stress-medium` creates Direct, Kueue, and Skaha `TestRun` resources with
`PROFILE=stress-medium`, `RUN_CLASS=stress`, `SCENARIO=throughput-stress`, `TOTAL_JOBS=10000`,
`LOGICAL_USERS=100`, `CONFIRM_STRESS=true`, `PRESERVE_ON_FAILURE=false`,
`VISIBILITY_GATE_SECONDS=900`, and `K6_OTEL_EXPORT_INTERVAL=15s`.

`stress-high` is Kueue-only by default and uses `PROFILE=stress-high`, `RUN_CLASS=stress`,
`TOTAL_JOBS=100000`, `LOGICAL_USERS=100`, `CONFIRM_STRESS=true`,
`KUEUE_ADMISSION_GATE_SECONDS=1800`, `VISIBILITY_GATE_SECONDS=1800`, and
`K6_OTEL_EXPORT_INTERVAL=30s`.

Stress success focuses on accepted and visible work, observability, and cleanup. Completion and
Kueue admission are recorded when they happen but are not hard runtime gates for stress profiles.
Do not schedule stress profiles by default.

## Manual Skaha `spot-tiny`

The repo-managed manual Skaha surface manifest contract is:

```text
docs/manifests/perfpulse-skaha-spot-tiny.yaml
```

Before applying it, replace:

- `images.opencadc.org/platform/perfpulse:TAG` with the published runner image tag.

The checked-in Skaha ConfigMap uses the internal staging service URL:

```text
http://canfar-skaha-staging-skaha-tomcat-svc.canfar-system-staging.svc.keel-prod.local:8080/skaha/v1
```

The default Skaha spot workload uses `images.canfar.net/skaha/stress-ng:latest` as a headless
session and runs the same command shape as Direct/Kueue: `stress-ng --cpu 1 --timeout
<duration-seconds>s --metrics-brief`. Direct/Kueue keep their Docker Hub default image
`docker.io/alexeiled/stress-ng`; only Skaha pivots to the CANFAR registry image.

Before running Skaha load tests, run the explicit auth setup:

```bash
bun run skaha-auth-setup
```

This command prompts for CANFAR username and password and creates or updates
`perfpulse-skaha-auth` in the `canfar-perfpulse` namespace with `username` and `password` keys. It
does not authenticate during setup, does not create a bearer token, and does not print the password.

The checked-in manifest intentionally stores only non-secret Skaha config in a ConfigMap and
mounts `perfpulse-skaha-auth` as a Secret volume. The runtime generates a bearer token from the
mounted credentials for each Skaha test run. Do not commit bearer tokens or passwords.

After a Skaha validation run, remove the auth Secret with:

```bash
bun run skaha-auth-cleanup
```

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
Direct, Kueue, and Skaha `spot-tiny` k6 Operator `TestRun` set per hour with a generated `testid`:

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

Each embedded scheduled `TestRun` follows the same pod contract as the manual M1 run: custom
PerfPulse image for initializer and runner, no custom starter image, `canfar-perfpulse` service
account on initializer/runner/starter, and restricted security contexts on each operator pod
template. The scheduled Skaha runner mounts `perfpulse-skaha-auth`; the scheduled Kueue runner has
Workload list/get RBAC. The CronJob creator pod also runs with restricted pod and container
security contexts.
