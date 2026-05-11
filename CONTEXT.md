# PerfPulse

PerfPulse is the performance evidence context for understanding CANFAR Science Platform
performance through production Grafana dashboards, routine cron checks, manual benchmarks, and
rare stress campaigns.

## Language

**PerfPulse**:
An in-cluster k6-based product for generating workload-path performance evidence and presenting
it through production observability surfaces.
_Avoid_: one-off benchmark script, local-only artifact generator

**Thin horizontal slice**:
The smallest deployed evidence path from k6 `TestRun` through direct Kubernetes workload
completion, low-volume OTLP metrics export to Prometheus, Grafana queryability, and cleanup.
_Avoid_: horizontal runner scaling, distributed k6 execution

**Kind smoke**:
A developer validation run in a local kind cluster that proves the custom k6 runner can execute
through the k6 Operator and complete one direct Kubernetes workload without Kueue, Skaha,
Prometheus, or Grafana.
_Avoid_: thin horizontal slice, production evidence path, OTLP metrics proof

**Cron check**:
A small hard-gated scheduled run that proves a workload path is healthy enough for operational
confidence. The current production cadence is every 5 minutes.
_Avoid_: smoke test, synthetic monitor

**Routine benchmark**:
A manual bounded run that measures comparable performance over time without intentionally finding
the cluster limit.
_Avoid_: stress test, cron check

**Stress campaign**:
A rare quiet-window run that characterizes cluster, control-plane, workload-execution,
observability, and cleanup boundaries.
_Avoid_: routine benchmark, scheduled check

**Test surface**:
One workload submission path that PerfPulse can drive and measure.
_Avoid_: backend, provider

**Direct Kubernetes baseline**:
The direct no-Kueue Job path used to prove the Kubernetes API, Job lifecycle, metrics export, and
cleanup without queueing complexity.
_Avoid_: user-facing platform path

**Kueue dependency surface**:
The direct Kueue Job path used to detect changes in queue admission, Workload visibility, and
upstream Kueue behavior.
_Avoid_: user-facing platform path

**Skaha user-facing surface**:
The headless session path through the Skaha API and the main CANFAR Science Platform user-facing
performance signal.
_Avoid_: direct Kubernetes baseline

**Visibility gate**:
The configured time window in which accepted work must become observable through the target
surface's status model.
_Avoid_: completion SLO

**Completion gate**:
The configured time window in which a tiny cron workload must reach the target terminal state.
_Avoid_: visibility gate, benchmark SLO

**Logical user**:
A synthetic user bucket used by k6 to model submission shape.
_Avoid_: real Skaha user, service account

**Expected jobs**:
The planned work count for one selected **Test surface** in a run. For cron this is currently one
job per surface; for campaigns it is `campaign.totalJobs` per selected surface. Dashboard
percentages use **Expected jobs** as the denominator so missing submission, visibility, and cleanup
work stays visible.
_Avoid_: submitted jobs, visible jobs, completed jobs

**Dashboard evidence surface**:
Grafana dashboards backed by Prometheus metrics ingested from k6 OTLP export. This is the primary
operator-facing PerfPulse output.
_Avoid_: local run artifact as primary output

## Relationships

- A **Cron check**, **Routine benchmark**, or **Stress campaign** runs one or more **Test surfaces**.
- A **Kind smoke** validates runner, operator, direct Kubernetes Job, completion, cleanup, and
  local artifacts before the **Thin horizontal slice**.
- A **Thin horizontal slice** proves exactly one **Test surface** before broader profiles are enabled.
- The **Direct Kubernetes baseline** is proven before the **Kueue dependency surface** and
  **Skaha user-facing surface**.
- **Dashboard evidence surface** is the primary output; run logs and artifacts are diagnostic
  support.
- A **Visibility gate** applies after submission succeeds and before completion is evaluated.
- A **Completion gate** is a hard cron-check gate for tiny direct Kubernetes and Skaha workloads.
- A **Logical user** can submit many workloads, but it is not necessarily a real authenticated user.
- **Expected jobs** are per **Test surface**, not shared across surfaces.

## Example Dialogue

> **Dev:** "Should the first PerfPulse run use Kueue and Skaha?"
> **Domain expert:** "No. First prove the thin horizontal slice with one completed direct Kubernetes baseline Job, then add Kueue admission and Skaha completion as separate test surfaces."

## Flagged Ambiguities

- "Horizontal deployment" is resolved as **Thin horizontal slice**, not distributed k6 runner
  parallelism.
- "Kind smoke" is resolved as local developer validation, not a substitute for OTLP-to-Prometheus
  metrics ingestion or Grafana queryability.
- "Cron check" is resolved as an operational hard gate, while **Routine benchmark** and
  **Stress campaign** are measurement activities with different failure semantics.
- "Production-first" means production dashboards are the primary PerfPulse outcome; staging and
  integration promotion gates reuse the same cron-check evidence model.
