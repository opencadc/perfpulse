# PerfPulse

PerfPulse is the performance evidence context for understanding CANFAR Science Platform
workload-submission behavior through production Grafana dashboards, routine cron checks, and
manual benchmark campaigns.

## Language

**PerfPulse**:
An in-cluster k6-based product for generating workload-path performance evidence and presenting
it through production observability surfaces.
_Avoid_: one-off benchmark script, local-only artifact generator

**Thin horizontal slice**:
The smallest deployed evidence path from one k6 runner through direct Kubernetes workload
submission, running visibility, OTLP metrics export to Prometheus, Grafana queryability, and
cleanup.
_Avoid_: horizontal runner scaling, distributed k6 execution

**Kind smoke**:
A developer validation run in a local kind cluster that proves the custom k6 runner can execute
and complete one direct Kubernetes workload without Kueue, Skaha, Prometheus, or Grafana.
_Avoid_: thin horizontal slice, production evidence path, OTLP metrics proof

**Cron check**:
A small hard-gated scheduled run that proves a workload path is healthy enough for operational
confidence. The production cadence is every 10 minutes.
_Avoid_: smoke test, synthetic monitor

**Benchmark campaign**:
A manual run that deposits `N` workloads on one or more **Test surfaces** to measure submission,
scheduling, visibility, and cleanup behavior under a chosen load.
_Avoid_: stress campaign type, cron check

**Run class**:
The top-level runtime mode: `cron` or `benchmark`.
_Avoid_: profile, campaign type

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

**Accept time**:
The instant a Kubernetes create request succeeds or the Skaha API returns a session id.
Observation for a workload begins at accept time.
_Avoid_: campaign start time, batch poll start

**Running visibility gate**:
The configured time window in which accepted work must become observable as actually scheduled:
Kubernetes Jobs need `status.active > 0` or terminal success, Kueue Jobs need the same Job
evidence, and Skaha sessions need `Running` or terminal success.
_Avoid_: created-object visibility, completion SLO

**Admission gate**:
The configured time window in which a Kueue Workload should be admitted on the **Kueue dependency
surface**. Admission is diagnostic evidence; running Job visibility is the target-state gate.
_Avoid_: completion gate, visibility gate

**Require completion**:
Whether a run waits for each accepted workload to reach a terminal state before the iteration
ends. Completion is optional and defaults off because benchmark evidence ends after running
visibility and cleanup. Cron operators may enable it when they want terminal-state evidence.
_Avoid_: hard benchmark gate, mandatory 60s wait

**Opportunistic completion**:
When **Require completion** is off, the iteration succeeds after running visibility. Completion
metrics are recorded only if the workload is already terminal during the visibility pass.
_Avoid_: completion poll, benchmark completion gate

**Per-job lifecycle**:
The ordered evidence path for one workload: submit, observe running visibility, optionally wait
for terminal completion, then delete. Observation begins when that workload is accepted, not after
all jobs in the run are submitted.
_Avoid_: batch-then-poll, bulk lifecycle

**Jobs per VU cap**:
The maximum workloads one k6 VU may own in a benchmark (`jobsPerVuCap`, default 500). Config
rejects runs where `logicalUsers < ceil(totalJobs / jobsPerVuCap)` and tells the operator to raise
`LOGICAL_USERS` or increase `JOBS_PER_VU_CAP`. For example 10,000 jobs with cap 500 requires at
least 20 VUs.
_Avoid_: sequential threshold, silent VU auto-raise

**Logical user**:
A synthetic user bucket used by k6 to model submission shape in metrics and labels.
_Avoid_: real Skaha user, service account, k6 VU

**Submission concurrency**:
The number of workloads whose lifecycle may run at the same time in one runner, expressed as k6
`vus` via `LOGICAL_USERS`.
_Avoid_: logical user count, parallel users

**User shape**:
The labeling dimension for how submitted work is attributed across **Logical user** buckets
(for example one bucket submitting many jobs vs many buckets each submitting few). Does not set k6
executor concurrency; **Submission concurrency** does.
_Avoid_: scenario executor, VU model

**Fixed workload footprint**:
The standard PerfPulse workload size on every **Test surface**: 1 CPU and 1 GiB RAM. Intentionally
small so measurements target submission, queueing, visibility, and cleanup, not resource pressure.
_Avoid_: tiny job profile, configurable workload size

**Fixed workload runtime**:
The standard in-pod execution time for every PerfPulse workload: 60 seconds. PerfPulse normally
deletes workloads after running visibility, so benchmark runs do not wait for this runtime unless
completion is explicitly required.
_Avoid_: job profile, duration sweep, workload duration override

**Expected jobs**:
The planned work count for one selected **Test surface** in a run. For cron this is currently one
job per surface; for benchmarks it is `campaign.totalJobs` per selected surface. Dashboard
percentages use **Expected jobs** as the denominator so missing submission, running visibility,
and cleanup work stays visible.
_Avoid_: submitted jobs, visible jobs, completed jobs

**Dashboard evidence surface**:
Grafana dashboards backed by Prometheus metrics ingested from k6 OTLP export. This is the primary
operator-facing PerfPulse output. One repo-managed dashboard serves both **Cron check**
steady-state health and **Benchmark campaign** drilldown by `testid`.
_Avoid_: local run artifact as primary output, split dashboards

## Relationships

- A **Cron check** or **Benchmark campaign** runs one or more **Test surfaces**.
- A **Kind smoke** validates runner, direct Kubernetes Job, completion, cleanup, and local
  artifacts before the **Thin horizontal slice**.
- A **Thin horizontal slice** proves exactly one **Test surface** before broader surfaces are
  enabled.
- The **Direct Kubernetes baseline** is proven before the **Kueue dependency surface** and
  **Skaha user-facing surface**.
- **Dashboard evidence surface** is the primary output; run logs and artifacts are diagnostic
  support.
- One Grafana dashboard artifact covers cron health and benchmark drilldown.
- Every **Test surface** uses the same **Fixed workload footprint** and **Fixed workload runtime**
  so comparisons isolate path behavior.
- Offline markdown report generators are out of scope; Grafana is the reporting surface.
- The `cohort` label dimension is dropped; mixed-pressure work is out of scope until reintroduced
  with a real second cohort value.
- `job_profile` duration variants are dropped in favor of **Fixed workload runtime**.
- A **Running visibility gate** applies after submission succeeds and before optional completion is
  evaluated.
- An **Admission gate** is diagnostic; **Kueue dependency surface** target state still requires the
  created Job to become running or terminal successful.
- **Require completion** defaults off. When it is off, **Opportunistic completion** applies:
  record completion only if the workload is already terminal during the visibility pass.
- Each workload follows a **Per-job lifecycle**: tracking starts at accept time, because work may
  finish before the last job in a large benchmark is submitted.
- A **Logical user** can submit many workloads, but it is not necessarily a real authenticated
  user.
- **User shape** labels attribution; **Submission concurrency** (`LOGICAL_USERS`) bounds how many
  **Per-job lifecycle** runs overlap in one k6 runner.
- **Expected jobs** are per **Test surface**, not shared across surfaces.

## Example Dialogue

> **Dev:** "Should the first PerfPulse run use Kueue and Skaha?"
> **Domain expert:** "No. First prove the thin horizontal slice with one direct Kubernetes baseline Job that reaches Running and cleans up, then add Kueue and Skaha as separate test surfaces."

## Flagged Ambiguities

- "Horizontal deployment" is resolved as **Thin horizontal slice**, not distributed k6 runner
  parallelism.
- "Kind smoke" is resolved as local developer validation, not a substitute for OTLP-to-Prometheus
  metrics ingestion or Grafana queryability.
- "Cron check" is resolved as an operational hard gate, while **Benchmark campaign** is a
  measurement activity whose target state is accepted, running-visible work plus cleanup.
- **Require completion** is resolved as optional; benchmark runs do not wait for the fixed 60s
  workload runtime by default.
- Large benchmarks use **Jobs per VU cap** (default 500): `logicalUsers` must be at least
  `ceil(totalJobs / jobsPerVuCap)`.
- **User shape** is a labeling dimension; **Submission concurrency** is `LOGICAL_USERS` VUs.
- Runtime configuration omits unused grouping, profile, campaign-type, and metric-profile
  switches; Helm owns native k6 runner Job/CronJob layout.
- "Production-first" means production dashboards are the primary PerfPulse outcome; staging and
  integration promotion gates reuse the same cron-check evidence model.
