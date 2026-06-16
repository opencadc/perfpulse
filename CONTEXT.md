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

**Admission gate**:
The configured time window in which a Kueue Workload must be admitted on the **Kueue dependency
surface**. A hard failure gate for **Cron check** only; diagnostic evidence for **Routine
benchmark** and **Stress campaign**.
_Avoid_: completion gate, visibility gate

**Require completion**:
Whether a run waits for each accepted workload to reach a terminal state before the iteration
ends. Required for **Cron check** and **Routine benchmark**; optional for **Stress campaign**
via configuration.
_Avoid_: completion gate, hard gate

**Opportunistic completion**:
When **Require completion** is off, the iteration succeeds after visibility. Completion metrics
are recorded only if the workload is already terminal during the visibility pass.
_Avoid_: completion poll, stress completion gate

**Per-job lifecycle**:
The ordered evidence path for one workload: submit, then observe visibility, then optionally
wait for terminal completion. Observation for a job begins when that job is accepted, not after
all jobs in the run are submitted.
_Avoid_: batch-then-poll, two-phase campaign

**Jobs per VU cap**:
The maximum workloads one k6 VU may own in a campaign (`jobsPerVuCap`, default 500). Config
rejects runs where `logicalUsers < ceil(totalJobs / jobsPerVuCap)` and tells the operator to raise
`LOGICAL_USERS` or increase `jobsPerVuCap`. For example 10,000 jobs with cap 500 requires at least
20 VUs. Applies to **Stress campaign** and **Routine benchmark** on all **Test surfaces** unless
a run class explicitly opts out.
_Avoid_: sequential campaign threshold, silent VU auto-raise

**Bulk Skaha stress lifecycle**:
On **Skaha user-facing surface** **Stress campaign** runs only: k6 runs with
`iterations = logicalUsers` and `vus = logicalUsers`. Each VU submits its full logical-user job
quota consecutively (`totalJobs / logicalUsers`), retains session ids, then polls pending sessions
in round-robin with a 1s global tick and at least ~15s between GETs for the same session id until
each reaches a terminal state or the **Completion gate** expires, and deletes each terminal session
immediately via the Skaha session DELETE API. Terminal `Failed` or `Error` sessions increment
failure metrics but do not abort the batch. The VU iteration does not end until every session in
the batch is terminal or timed out. Other surfaces and run classes keep **Per-job lifecycle** and
`iterations = totalJobs`.
_Avoid_: per-job lifecycle, shared-iterations stress shape on Skaha, visible-only stress exit,
deferred bulk cleanup, fixed 15s full-batch scan only

**Logical user**:
A synthetic user bucket used by k6 to model submission shape in metrics and labels.
_Avoid_: real Skaha user, service account, k6 VU

**Submission concurrency**:
The number of workloads whose lifecycle may run at the same time in one `TestRun`, expressed as
k6 `vus` via `LOGICAL_USERS`. On **Bulk Skaha stress lifecycle** runs each VU owns up to
**Jobs per VU cap** workloads in one iteration; on other runs **Submission concurrency** bounds
overlapping **Per-job lifecycle** work.
_Avoid_: logical user count, parallel users

**User shape**:
The labeling dimension for how submitted work is attributed across **Logical user** buckets
(for example one bucket submitting many jobs vs many buckets each submitting few). Does not
set k6 executor concurrency; **Submission concurrency** does.
_Avoid_: scenario executor, VU model

**Fixed workload footprint**:
The standard PerfPulse workload size on every **Test surface**: 1 CPU and 1 GiB RAM. Intentionally
small so measurements target submission, queueing, visibility, and cleanup—not resource pressure.
_Avoid_: tiny job profile, configurable workload size

**Fixed workload runtime**:
The standard in-pod execution time for every PerfPulse workload: 60 seconds. Same on all **Test
surfaces** and run classes.
_Avoid_: job profile, duration sweep, workload duration override

**Expected jobs**:
The planned work count for one selected **Test surface** in a run. For cron this is currently one
job per surface; for campaigns it is `campaign.totalJobs` per selected surface. Dashboard
percentages use **Expected jobs** as the denominator so missing submission, visibility, and cleanup
work stays visible.
_Avoid_: submitted jobs, visible jobs, completed jobs

**Dashboard evidence surface**:
Grafana dashboards backed by Prometheus metrics ingested from k6 OTLP export. This is the primary
operator-facing PerfPulse output. Two repo-managed dashboard artifacts serve operators: one for
**Cron check** steady-state health and one for **Routine benchmark** / **Stress campaign**
drilldown by `testid`.
_Avoid_: local run artifact as primary output, single monolithic dashboard

## Relationships

- A **Cron check**, **Routine benchmark**, or **Stress campaign** runs one or more **Test surfaces**.
- A **Kind smoke** validates runner, operator, direct Kubernetes Job, completion, cleanup, and
  local artifacts before the **Thin horizontal slice**.
- A **Thin horizontal slice** proves exactly one **Test surface** before broader profiles are enabled.
- The **Direct Kubernetes baseline** is proven before the **Kueue dependency surface** and
  **Skaha user-facing surface**.
- **Dashboard evidence surface** is the primary output; run logs and artifacts are diagnostic
  support.
- Two Grafana dashboard artifacts replace the monolithic overview: cron health and campaign
  drilldown.
- Every **Test surface** uses the same **Fixed workload footprint** and **Fixed workload
  runtime** so comparisons isolate path behavior.
- Offline markdown report generators are out of scope; Grafana is the reporting surface.
- The `cohort` label dimension is dropped; mixed-pressure work is out of scope until reintroduced
  with a real second cohort value.
- `job_profile` duration variants are dropped in favor of **Fixed workload runtime**.
- A **Visibility gate** applies after submission succeeds and before completion is evaluated.
- A **Completion gate** is a hard cron-check gate for tiny direct Kubernetes and Skaha workloads.
- An **Admission gate** is a hard cron-check gate for Kueue only; campaigns record admission
  latency without failing solely on slow admission.
- **Require completion** is on for **Cron check** and **Routine benchmark**; **Stress campaign**
  may turn it off so iterations end after submit and visibility.
- When **Require completion** is off, **Opportunistic completion** applies: record completion
  only if the workload is already terminal during the visibility pass.
- **Require completion** defaults on for **Cron check** and **Routine benchmark**, and off for
  **Stress campaign**; operators may override for a specific run except on **Cron check**.
- Each workload follows a **Per-job lifecycle**: tracking starts at accept time, because work may
  finish before the last job in a large campaign is submitted.
- **Skaha user-facing surface** **Stress campaign** runs use **Bulk Skaha stress lifecycle**
  instead of **Per-job lifecycle**; all other surfaces and run classes keep **Per-job lifecycle**.
- A **Logical user** can submit many workloads, but it is not necessarily a real authenticated user.
- **User shape** labels attribution; **Submission concurrency** (`LOGICAL_USERS`) bounds how
  many **Per-job lifecycle** runs overlap in one `TestRun`.
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
- **Require completion** is resolved as always-on for cron and benchmark, configurable off for
  stress campaigns.
- Large campaigns use **Jobs per VU cap** (default 500): `logicalUsers` must be ≥
  `ceil(totalJobs / jobsPerVuCap)`.
- **Skaha user-facing surface** **Stress campaign** uses **Bulk Skaha stress lifecycle**;
  other surfaces use concurrent **Per-job lifecycle** with `iterations = totalJobs`.
- **User shape** is a labeling dimension; **Submission concurrency** is `LOGICAL_USERS` VUs.
- Runtime configuration omits unused grouping and metric-profile switches; Helm owns TestRun
  layout per **Test surface**.
- "Production-first" means production dashboards are the primary PerfPulse outcome; staging and
  integration promotion gates reuse the same cron-check evidence model.
