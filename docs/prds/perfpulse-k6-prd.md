# PerfPulse k6 Migration PRD

## Problem Statement

The current Kueue performance exploration lives in
`https://github.com/opencadc/deployments/configs/kueue/kueuer` as a Python
CLI named `kr`. It was useful for early investigation, but it is not the right long-term
shape for CANFAR performance testing.

The existing tool answers two core questions:

1. Can Kueue handle very large batch queues without breaking admission, preemption,
   requeueing, or workload visibility?
2. Does Kueue add unacceptable Kubernetes control-plane load when many Jobs are created
   and tracked?

It does this by launching Kubernetes `batch/v1` Jobs, optionally adding Kueue labels,
tracking creation-to-completion timing, collecting controller and API-server pressure,
and writing CSV/plot/report artifacts. The important concepts are sound, but the delivery
model is not:

- It depends on local Python tooling and ad hoc plot artifacts instead of the production
  observability stack.
- It primarily compares direct Kubernetes Jobs with and without Kueue, while the platform
  also needs Skaha API driven workloads.
- It treats many tests as one large batch submission, which does not clearly separate
  single-user bulk pressure from many-user burst pressure.
- It records useful metrics, but they are not emitted as first-class Prometheus time
  series that can be queried, alerted on, and dashboarded consistently.
- It is easy to run large experiments manually, but harder to standardize spot checks,
  benchmark campaigns, and stress campaigns under one test harness.

PerfPulse should replace `kr` completely. The new system should be an in-cluster k6 based
performance harness that can drive direct Kubernetes APIs and Skaha APIs, emit production
metrics through Prometheus remote write, and support small routine checks as well as large
rare stress campaigns.

## Vision and Intent

PerfPulse is a cluster-native performance evidence product, not a one-off benchmark script.
Its job is to answer a small set of operational questions repeatedly:

- Can the deployed cluster accept workload submissions through the supported platform paths?
- Can accepted work be observed through Kubernetes, Kueue, Skaha, Prometheus, and Grafana?
- Can operators spot a regression quickly enough to decide whether the fault is submission,
  queueing, status visibility, observability, or cleanup?
- Can the same harness scale from tiny recurring spot checks to rare stress campaigns without
  changing the measurement model?

The first product milestone must therefore be the smallest thin horizontal slice: one k6
`TestRun`, one direct Kubernetes workload that completes within the gate, one remote-write
metrics path, one repo-managed Grafana dashboard artifact, and one cleanup path. That slice
proves the deployed feedback loop. Additional surfaces and larger profiles are added only
after the previous slice has a deterministic pass/fail signal.

The phrase "horizontal deployment" means this thin deployed evidence path. It does not mean
distributed k6 runner parallelism. Distributed execution is a later scaling option, not a
requirement for the first working product.

## Goals

PerfPulse must support two major classes of tests.

### Stress Campaigns

Stress campaigns are rare, large-scale tests used to characterize and validate cluster
capacity. Examples include 10,000 or 100,000 `stress-ng` jobs. They may run only once in
a while, and they exist to discover throughput limits, queue behavior, API-server pressure,
and control-plane failure boundaries.

For stress campaigns, success is primarily:

- Jobs or sessions are accepted by the target surface.
- Accepted work becomes visible within the configured SLO or baseline envelope.
- The cluster and controllers remain observable and recoverable.
- Cleanup succeeds or leaves resources clearly labeled for manual follow-up.

Completion is secondary for stress campaigns. It is useful to record, but the primary
question is whether a large amount of work can be submitted, queued, observed, and managed.

### Routine Benchmarks and Spot Checks

Routine benchmarks are smaller but run more often. They should simulate user behavior and
produce comparable performance time series over time. Examples include:

- A single logical user submitting many Jobs through the Kubernetes API.
- Many logical users each submitting one or a small number of Jobs.
- A user submitting work through the Skaha API and polling status until visible or complete.
- Hourly spot checks to verify that the workload path, Kueue, Skaha, Prometheus remote
  write, and cleanup are still working.

For routine benchmarks and spot checks, success is:

- Submission succeeds.
- The created work becomes visible within the configured gate.
- Cleanup succeeds.
- The expected low-cardinality metrics appear in Prometheus and Grafana.
- Failures are clear enough to identify whether the problem is auth, Kubernetes API,
  Kueue admission, Skaha API, visibility polling, metrics export, or cleanup.

### Diagnostic Discipline

Every PerfPulse milestone should follow the same diagnosis loop:

1. Build a fast pass/fail feedback loop.
2. Reproduce the behavior under a small bounded profile.
3. State ranked, falsifiable hypotheses before increasing scale.
4. Instrument only the boundaries that distinguish those hypotheses.
5. Convert the minimized behavior into a regression gate where possible.
6. Remove temporary instrumentation and preserve the final hypothesis in the run notes.

This matters most for performance failures. PerfPulse should measure before proposing fixes.
For example, a Kueue visibility regression should first produce evidence for create latency,
workload visibility latency, API failures, queue depth, and controller health before the team
changes queue configuration or runner parallelism.

## Solution

Build a greenfield TypeScript k6 project in `opencadc/perfpulse`. The project will bundle
TypeScript to JavaScript, package that JavaScript into a custom k6 runner image, and execute
it inside the cluster through the installed Grafana k6 Operator.

The k6 runner will drive three surfaces:

1. Direct Kubernetes `batch/v1` Job deployment with Kueue.
2. Direct Kubernetes `batch/v1` Job deployment without Kueue.
3. Headless job/session deployment through the Skaha API.

All workload Jobs must land in `canfar-workloads`. k6 `TestRun` resources and the supporting
PerfPulse control resources should live in `canfar-perfpulse`.

The first implementation sequence should validate the system in three steps:

1. M0 establishes the local Bun TypeScript project, bundle, tests, and no-op k6 dry run.
2. M0.5 runs a kind-backed Kubernetes-only smoke through the k6 Operator and captures k6 HTML
   dashboard output plus logs.
3. M1 validates the smallest deployed evidence path:

- A custom v1 runner image.
- One manual `spot-direct-tiny` k6 `TestRun`.
- One 10s tiny direct Kubernetes `stress-ng` Job without Kueue, completed within 120s.
- Prometheus remote write enabled.
- Native histogram mode enabled for k6 trend metrics when the Prometheus path supports it,
  with `p50,p95,p99` trend-stat fallback for M1.
- Low-cardinality custom metrics.
- k6 teardown plus Kubernetes TTL cleanup.
- One repo-managed minimal Grafana dashboard JSON artifact that proves the metrics are
  queryable by `testid`.

The implementation must be designed so the same harness can later scale to benchmark and
stress profiles without changing architecture.

## Incremental Delivery Plan

### M0: Product Contract and Local Harness

Purpose:

- Establish the TypeScript project shape, k6 bundle, profile model, metric contracts, and
  manifest contracts before cluster deployment.

Acceptance:

- Set up a Bun-based TypeScript project with linting, type checking, unit tests, and GitHub
  Actions PR checks.
- TypeScript builds into one k6-compatible JavaScript bundle.
- Unit tests cover profile resolution, tag allowlists, metric names, Kubernetes label
  generation, and the direct Kubernetes Job manifest.
- A local k6 dry run can execute the script with a mocked or no-op workload path.
- The runbook contains the exact command, required environment, expected metrics, and executor
  rationale for the first script.

### M0.5: Kind Smoke, Kubernetes Only

Purpose:

- Validate the custom k6 runner, k6 Operator execution path, direct Kubernetes Job lifecycle, and
  artifact capture in a local kind cluster before introducing Prometheus remote write.

Scope:

- One locally built custom image.
- One local kind cluster.
- One pre-installed k6 Operator.
- One `TestRun` in `canfar-perfpulse`.
- One direct no-Kueue `batch/v1` Job in `canfar-workloads`.
- One static k6 web dashboard HTML export.
- Runner and `TestRun` logs.

Acceptance:

- The smoke script assumes a kind cluster and k6 Operator are already available and fails fast if
  they are missing.
- The custom image is built and loaded into kind.
- The `TestRun` starts with the custom image.
- The runner authenticates to the Kubernetes API with a service account.
- The runner creates exactly one direct Kubernetes Job without Kueue labels.
- The Job is visible by PerfPulse labels.
- The Job completes within the configured completion gate.
- The runner cleanup removes the Job.
- The script stores `k6-web-dashboard.html`, runner logs, `TestRun` describe output, and
  post-cleanup workload Job state under `artifacts/kind-smoke/<testid>/` after the `TestRun`
  passes.
- Live web dashboard port-forwarding is available for interactive local runs but is not required
  in CI.
- Prometheus, Grafana, Kueue, Skaha, scheduled runs, and stress profiles remain out of scope.

### M1: Thin Horizontal Slice, Direct Kubernetes Only

Purpose:

- Prove the deployed feedback loop with the least risky workload path.

Scope:

- One custom image.
- One service account and RBAC path.
- One `TestRun` in `canfar-perfpulse`.
- One direct no-Kueue `batch/v1` Job in `canfar-workloads`.
- One `testid`.
- One remote-write metrics path.
- One cleanup path.
- One repo-managed Grafana dashboard JSON artifact.

Acceptance:

- The `TestRun` starts and uses the custom image.
- The runner authenticates to the Kubernetes API.
- The direct Job create call succeeds.
- The Job is visible by PerfPulse labels.
- The Job completes within the 120s completion gate.
- The runner emits submission, visibility, completion, HTTP, check, and cleanup metrics.
- Prometheus stores the metrics with only approved tags.
- The repo-managed Grafana dashboard can query the run by `testid`.
- Cleanup deletes the Job, or the TTL safety net removes it.

### M2: Kueue Surface

Purpose:

- Add Kueue admission after the direct Kubernetes path is proven.

Acceptance:

- One direct Kueue Job is accepted with the configured queue labels.
- The corresponding Kueue Workload becomes admitted within the configured gate.
- A visible-but-not-admitted tiny spot Workload is a hard spot-check failure.
- Kueue surface metrics use the same tag and threshold model as M1.
- Direct no-Kueue and Kueue surfaces can run separately for diagnosis.

### M3: Skaha Surface

Purpose:

- Add the user-facing platform API path after the Kubernetes and Kueue paths are proven.

Acceptance:

- The runner authenticates to Skaha with runtime-token auth.
- One headless Skaha session is accepted, visible, and completed within the configured gate.
- Skaha cleanup deletes the session.
- Skaha metrics share the same surface, scenario, visibility, and cleanup contracts.
- Skaha resource differences are documented as surface differences, not resource parity.

### M4: `spot-tiny` Across Stable Surfaces

Purpose:

- Turn the manual proofs into a small operational spot check.

Acceptance:

- `spot-tiny` can run all stable surfaces enabled for the environment.
- Each enabled surface has hard gates for create, target state, remote-write presence, and cleanup.
- The dashboard shows submitted, visible, completed/admitted, failed, latency, and cleanup
  panels by surface.
- A failed run categorizes the failure without using unbounded Prometheus labels.

### M5: Scheduled Spot Checks

Purpose:

- Make the spot check recurring without making benchmark or stress behavior automatic.

Acceptance:

- A Kubernetes `CronJob` creates bounded `spot-tiny` `TestRun` resources.
- Runs do not overlap unless explicitly configured.
- The generated `testid` is stable enough for Grafana filtering and cleanup.
- Alerting is limited to missing or failed spot checks.

### M6: Routine Benchmarks

Purpose:

- Add repeatable low- and medium-scale benchmark profiles after the spot-check loop is stable.

Acceptance:

- `benchmark-small` and `benchmark-medium` run as manual profiles.
- Baselines are derived from repeated successful runs, not guessed in advance.
- The benchmark report compares accepted work, visible work, latency, cleanup, dropped
  iterations, and relevant cluster metrics.
- Benchmark thresholds fail the `TestRun` only after baselines exist.

### M7: Stress Campaigns

Purpose:

- Characterize cluster and control-plane boundaries under large workload submissions.

Acceptance:

- `stress-medium` and `stress-high` require explicit profile selection.
- Stress campaigns abort only for safety failures, not for discovering capacity limits.
- The report records accepted work, visible work, rejection categories, dropped iterations,
  API-server pressure, Kueue controller health, and cleanup status.
- Preserve-on-failure mode leaves clearly labeled resources only when explicitly enabled.

## Current `kueuer` Project Overview

`kueuer` is a Python project under `configs/kueue/kueuer`. Its CLI is `kr`.

The project currently contains these major areas:

- Benchmark commands that create Kubernetes Jobs with and without Kueue.
- Eviction scenarios that exercise priority, preemption, requeue, and workload state.
- E2E orchestration that runs preflight checks, benchmark phases, observation, plotting,
  reporting, and teardown.
- Observation collectors for Kueue controller pressure, API-server latency, queue depth,
  and workload wait times.
- CSV, YAML, JSON, Markdown, and plot artifacts written under an artifact run directory.

The current benchmark metrics include:

- `throughput`
- `completion_ratio`
- `tail_job_turnaround_s`
- `turnaround_overhead_s`
- `completed_jobs_tracked`
- `total_execution_time`
- `submission_jobs_applied`
- `submission_jobs_failed_to_apply`
- `submission_manifest_apply_seconds`
- `submission_chunk_spawn_seconds`
- `pods_oomkilled`
- `kueue_controller_restarts_delta`

The current observation metrics include:

- Kueue controller working-set memory.
- Kueue controller CPU.
- Kueue controller restarts.
- API-server p95 and p99 latency.
- API-server inflight request pressure.
- Pending Workloads.
- Admitted Workloads.
- Workload queue wait p50 and p95.
- OOMKilled benchmark Pods.

The current eviction metrics include:

- Priority class.
- Admission time.
- Finish time.
- Requeue count.
- Preemptor relationships.

The current profiles are:

- `local-safe`: small local smoke-test defaults.
- `cluster-scale`: heavier queue-pressure defaults.

Those profile names and values should not be carried forward directly. The new PerfPulse
profiles should be named for the operational purpose and scale of the test.

The current `kr` model should be treated as prior art only. PerfPulse is a clean replacement,
not a compatibility layer.

## Target Architecture

PerfPulse should be a Bun-managed TypeScript project with a small set of deep modules that hide
protocol details behind test-oriented interfaces.

### TypeScript Tooling

The v1 project uses Bun for package management, tests, and bundling. The generated k6 bundle must
externalize `k6`, `k6/*`, and future xk6 imports so the output runs under k6 rather than Bun.

GitHub Actions PR checks should run Bun install, linting, type checking, unit tests, bundling, and
the local no-op k6 dry run. The kind smoke should be a manual `workflow_dispatch` workflow.

### Runtime Model

The runtime is k6, launched by the Grafana k6 Operator as a `TestRun`.

The runner image is:

```text
images.opencadc.org/platform/perfpulse:TAG
```

The bundled k6 script should be available inside the image and referenced by:

```yaml
spec:
  parallelism: 1
  script:
    localFile: /test/perfpulse.js
  runner:
    image: images.opencadc.org/platform/perfpulse:TAG
```

Using `localFile` avoids large ConfigMap script payloads and matches the custom-image
decision. ConfigMaps should hold configuration, not the compiled test program.

### Kubernetes API Client

k6 will call the Kubernetes API server directly using in-cluster service account credentials:

- Token file: `/var/run/secrets/kubernetes.io/serviceaccount/token`
- CA file: `/var/run/secrets/kubernetes.io/serviceaccount/ca.crt`
- API server: `https://kubernetes.default.svc`

The client must support:

- Create `batch/v1` Jobs.
- List Jobs by PerfPulse labels.
- Get Jobs by name when needed.
- Delete Jobs by label or name during cleanup.
- List Kueue Workloads by label for visibility checks on the Kueue surface.
- List LocalQueues for optional preflight and dashboard context.

The first version uses polling/listing, not Kubernetes watches. Polling is simpler, predictable
inside k6, and easier to bound for large stress campaigns. Watches can be evaluated later if
polling becomes too expensive.

### Skaha API Client

k6 will call the Skaha session API directly over HTTP.

The v1 credential shape is runtime-token based:

- `SKAHA_API_URL`
- `SKAHA_TOKEN`

Every Skaha request should include:

```text
Authorization: Bearer <token>
X-Skaha-Authentication-Type: RUNTIME-TOKEN
Content-Type: application/x-www-form-urlencoded
Accept: application/json
```

The v1 Skaha operations are:

- `POST /session` to create a headless session.
- `GET /session/{id}` to poll visibility and status.
- `DELETE /session/{id}` to clean up.

The create request should model the current CANFAR session client behavior:

- `name`
- `image`
- `type=headless`
- `cores`
- `ram`
- `cmd`
- `args`
- optional `env` values

Skaha has minimum resource validation of `cores >= 1` and `ram >= 1` GB. Direct Kubernetes
surfaces can use smaller resource requests, but Skaha should use `cores=1` and `ram=1` in
v1 and be compared as its own surface.

### Configuration Sources

PerfPulse should use four configuration layers:

1. Image: versioned TypeScript code, scenarios, default profiles, helper modules.
2. ConfigMap: non-secret environment config such as namespaces, queue defaults, Skaha URL,
   Prometheus remote write URL, profile defaults, and threshold defaults.
3. Secret: Skaha runtime token and any remote-write credentials.
4. TestRun environment: run-specific overrides such as `TESTID`, `RUN_CLASS`, `SCENARIO`,
   `SURFACE`, profile, total job count, user shape, duration, metric profile, and cleanup mode.

The implementation should provide canned profiles and allow constrained overrides. Overrides
must not silently allow dangerous values. Large stress profiles should require explicit profile
selection and should not be reachable by typo or default.

The canonical run identity is `testid`. Use `TESTID` or `testid` consistently for public
configuration, Kubernetes labels, k6 tags, dashboard variables, and run evidence. Do not expose
`RUN_ID` as a separate public concept; if an implementation accepts it as an alias, it must map
to `testid` before validation and metric tagging.

Stress profiles require both explicit stress profile selection and `CONFIRM_STRESS=true`.
Without that confirmation, the runner must fail configuration validation before creating any
workloads.

### k6 Script Structure

Every k6 script should follow the standard five-block pattern:

1. Imports.
2. k6 options with scenarios and thresholds.
3. shared data and static configuration.
4. `setup()`.
5. VU workload functions and `teardown()`.

Every scenario delivered by the project must include:

- A complete runnable k6 script bundle.
- The exact run command or `TestRun` manifest values needed to execute it.
- A one-line executor rationale that states whether the scenario is closed-model or open-model.

Checks are diagnostics, not gates. Pass/fail behavior must come from thresholds, explicit
configuration validation failures, or unrecoverable `fail()` calls. Scenario code should include
realistic think time where it models user behavior; submission-only stress scenarios may omit
think time only when the profile explicitly states that the goal is maximum create pressure.

The project should avoid k6 overhead that contaminates the benchmark:

- Use `SharedArray` for static profile/config data if any sizeable data is loaded.
- Keep `open()` calls in init context only; never load files inside VU functions.
- Avoid per-job Prometheus labels.
- Disable optional high-cardinality k6 system tags such as `vu` and `iter`.
- Use stable HTTP `name` tags so raw URLs and resource names do not become time series labels.
- Use bounded VUs and logical user buckets instead of one VU per logical user for large tests.
- Use aggregate polling for large stress runs.
- Emit custom Trend metrics sparingly.
- Prefer built-in k6 metrics where they already answer the question.
- Size `preAllocatedVUs` for arrival-rate tests from observed p95 response time and watch
  `dropped_iterations`.
- Set `gracefulStop` high enough for expected p99 request or polling duration.

M0 local validation uses a no-op client mode to prove the bundle, options, thresholds, tags,
and summary behavior. No-op is a local execution mode, not a `surface` value, and it must not
appear in production metric or dashboard surface filters.

M0.5 kind validation uses Kubernetes client mode, the k6 Operator, and one real direct Kubernetes
Job. It supports live k6 web dashboard port-forwarding during the runner execution and stores a
static k6 web dashboard HTML artifact from the same built bundle after the `TestRun` passes, but
does not enable Prometheus remote write or Grafana queryability.

## Test Surfaces

### Direct Kubernetes with Kueue

This surface creates `batch/v1` Jobs directly through the Kubernetes API and opts them into
Kueue by setting queue labels and starting suspended.

Default v1 queue configuration:

```text
namespace: canfar-workloads
queueName: cadc-default
priorityClass: low
```

The Job metadata should include:

```text
kueue.x-k8s.io/queue-name=cadc-default
kueue.x-k8s.io/priority-class=low
```

The Job spec should include:

```text
spec.suspend=true
spec.backoffLimit=0
spec.ttlSecondsAfterFinished=<configured TTL>
spec.activeDeadlineSeconds=<bounded deadline>
```

Admission success for this surface means:

- The Job create call returned success.
- The Job is visible through Kubernetes list/get by PerfPulse labels.
- The corresponding Kueue Workload becomes visible.
- The corresponding Kueue Workload is admitted within the configured admission gate.

For spot checks, visible-but-not-admitted is a hard failure because the tiny workload should
enter the queue and be admitted quickly. For stress campaigns, accepted and visible/admitted
counts are recorded separately so capacity limits are characterized rather than hidden.

### Direct Kubernetes without Kueue

This surface creates `batch/v1` Jobs directly through the Kubernetes API without Kueue labels.

The Job spec should include:

```text
spec.suspend=false
spec.backoffLimit=0
spec.ttlSecondsAfterFinished=<configured TTL>
spec.activeDeadlineSeconds=<bounded deadline>
```

Completion success means:

- The Job create call returned success.
- The Job is visible through Kubernetes list/get by PerfPulse labels.
- The Job reaches `Complete` within the configured completion gate for spot profiles.

This surface is both a baseline comparator and an independent cluster sanity path.

### Skaha API

This surface creates Skaha headless sessions through the Skaha API.

The session should request the same logical `stress-ng` workload shape as direct Kubernetes
surfaces, but exact Kubernetes manifests do not need to be byte-for-byte identical. Skaha
should be evaluated as a platform API surface with its own auth, validation, translation,
queueing, and status behavior.

Completion success means:

- The create API returned a session ID.
- `GET /session/{id}` returns a recognizable session object.
- The session status is `Pending`, `Running`, `Completed`, or another expected Skaha status
  that proves the session has entered the platform status model.
- For spot profiles, the session reaches `Completed` within the configured completion gate.

For stress campaigns, `Pending` or queued visibility is enough for the primary success path,
with completion recorded separately when feasible. For spot checks, completion is a hard gate.

## Workload Design

All workload Jobs and sessions use `stress-ng`. The workload exists to consume bounded CPU
and memory while keeping the primary measurement focused on submission, queueing, visibility,
and status behavior.

### Direct Kubernetes Default Workload

Direct Kubernetes surfaces use tiny fixed Jobs by default:

```text
cpu request: 100m
cpu limit: 100m
memory request: 256Mi
memory limit: 256Mi
ephemeral-storage request: 1Gi
ephemeral-storage limit: 1Gi
```

The default command should be equivalent to:

```text
stress-ng --cpu 1 --cpu-method matrixprod --vm 1 --vm-bytes <bounded value> --temp-path /tmp --timeout <duration> --metrics-brief
```

The `vm-bytes` value should be safely below the memory limit. A reasonable v1 default is
80 percent of the memory request/limit.

### Skaha Default Workload

Skaha uses the API minimums:

```text
cores: 1
ram: 1
type: headless
```

The command and args should still launch `stress-ng` with the same duration profile.

### Duration Profiles

The named job-duration profiles are:

| Job profile | Duration |
| --- | ---: |
| `tiny` | 10s |
| `small` | 30s |
| `standard` | 45s |
| `heavy` | 60s |

Large stress campaigns should default to shorter runtimes to avoid turning submission tests
into long resource-consumption campaigns. The `heavy` profile exists for explicit overrides,
not as the default for stress-high.

## Test Profiles

PerfPulse should ship canned profiles. Each profile defines scale, default scenario shape,
metric profile, duration, and safety behavior.

### `spot-direct-tiny`

Purpose:

- First deployed thin horizontal slice.
- Prove k6 Operator execution, custom image, Kubernetes API auth, direct Job creation,
  visibility polling, remote write, Grafana queryability, and cleanup.
- Avoid Kueue and Skaha complexity until the runner, metrics, and cleanup path are proven.

Defaults:

```text
run_class: spot
surfaces: k8s-direct
jobs_per_surface: 1
job_profile: tiny
duration: 10s
metric_profile: full
visibility_gate: 60s
completion_gate: 120s
cleanup: true
preserve_on_failure: false
testrun_grouping: combined
```

### `spot-tiny`

Purpose:

- Hourly sanity check after the direct Kubernetes, Kueue, and Skaha surfaces have each been
  proven independently.
- Prove all enabled stable surfaces still work.
- Prove remote write and dashboard queries work.
- Catch auth, API, queue, visibility, and cleanup failures.

Defaults:

```text
run_class: spot
surfaces: enabled stable surfaces from k8s-direct, k8s-kueue, skaha
jobs_per_surface: 1
job_profile: tiny
duration: 10s
metric_profile: full
visibility_gate: 60s
completion_gate: 120s
kueue_admission_gate: 120s
cleanup: true
preserve_on_failure: false
testrun_grouping: combined
```

### `benchmark-small`

Purpose:

- Routine user-shape benchmark at low scale.
- Compare surfaces over time without imposing large cluster pressure.

Defaults:

```text
run_class: benchmark
surfaces: k8s-kueue, k8s-direct, skaha
jobs_per_surface: 100
job_profile: small
duration: 30s
metric_profile: full
visibility_gate: baseline-derived after initial runs
cleanup: true
testrun_grouping: separate per surface or combined only when safe
```

### `benchmark-medium`

Purpose:

- Larger routine benchmark.
- Measure submission and visibility curves for meaningful queue pressure.

Defaults:

```text
run_class: benchmark
surfaces: k8s-kueue, k8s-direct, skaha
jobs_per_surface: 1000
job_profile: standard
duration: 45s
metric_profile: full
cleanup: true
testrun_grouping: separate per surface
```

### `stress-medium`

Purpose:

- Rare stress campaign.
- Characterize behavior around 10,000 jobs per surface.

Defaults:

```text
run_class: stress
surfaces: k8s-kueue, k8s-direct, skaha
confirm_stress: true
jobs_per_surface: 10000
job_profile: small
duration: 30s
metric_profile: lean
cleanup: true
preserve_on_failure: configurable
testrun_grouping: separate per surface
```

### `stress-high`

Purpose:

- Rare high-scale campaign.
- Characterize direct Kueue behavior around 100,000 jobs.

Defaults:

```text
run_class: stress
confirm_stress: true
default_surfaces: k8s-kueue
optional_surfaces: k8s-direct, skaha
jobs_per_surface: 100000
job_profile: small
duration: 30s
metric_profile: lean
cleanup: true
preserve_on_failure: configurable
testrun_grouping: separate per surface
```

The no-Kueue and Skaha surfaces must require explicit enablement for `stress-high`.

## Scenario Shapes

PerfPulse must distinguish workload size from user-shape pressure. The same total number of
jobs can mean very different things depending on who submits them.

### `single-bulk-user`

One logical user submits many jobs.

Example:

```text
logical_users: 1
jobs_per_logical_user: 100
total_jobs: 100
```

This models a user launching a large batch that enters the queue.

### `many-small-users`

Many logical users each submit a small number of jobs.

Example:

```text
logical_users: 100
jobs_per_logical_user: 1
total_jobs: 100
```

This models concurrent users applying pressure while other work exists in the cluster.

### `throughput-stress`

The test drives a target creation rate or controlled concurrency and records:

- Accepted jobs per second.
- Failed submissions.
- Visibility latency.
- Dropped iterations.
- API response status distribution.
- Queue visibility over time.

This is the right shape when the question is "how fast can this surface accept work?"

### Mixed Background and Foreground Pressure

A later phase should support:

- A background `single-bulk-user` campaign that fills the queue.
- Foreground `many-small-users` submissions while the queue is already under pressure.

This models the critical real-world case: one user launches many jobs, then other users
arrive and submit small workloads while the cluster is busy.

## k6 Executor Strategy

k6 executor choice must match the scenario.

### Spot Checks

Use small closed-model scenarios. A tiny number of VUs is enough.

Recommended executor:

```text
shared-iterations or per-vu-iterations
```

Rationale:

- The test should do a bounded amount of work and exit.
- There is no need to maintain a target request rate.

### User-Shape Benchmarks

Use bounded VUs and logical user buckets.

Recommended executor:

```text
shared-iterations
```

Rationale:

- Total work is known.
- VU count should be bounded to avoid k6 runner overhead becoming the measured bottleneck.
- Logical users are represented by stable synthetic buckets, not by one VU per real user.

### Throughput Stress

Use an open-model executor.

Recommended executor:

```text
constant-arrival-rate or ramping-arrival-rate
```

Rationale:

- The test asks how many create attempts per time unit the target can sustain.
- `dropped_iterations` becomes a meaningful signal when k6 cannot keep up.
- `preAllocatedVUs` and `maxVUs` must be sized from observed p95 create latency.

### Completion Tracking

Completion tracking should not create one VU per Job. For large tests, aggregate polling by
labels should record cohort-level state.

## Metrics

PerfPulse must rely on k6 built-in metrics where possible and define custom metrics only
for domain-specific events that k6 does not know about.

All custom metrics should use the `perfpulse_` prefix in code. In Prometheus remote write,
k6 adds the `k6_` namespace and counter suffixes, so a k6 Counter named
`perfpulse_jobs_submitted` will appear as a Prometheus series like
`k6_perfpulse_jobs_submitted_total`.

Do not name k6 Counters with `_total` in code.

### Required Custom Counters

| k6 metric name | Purpose |
| --- | --- |
| `perfpulse_jobs_submitted` | Count accepted Job/session create attempts. |
| `perfpulse_jobs_submission_failed` | Count create attempts that failed. |
| `perfpulse_jobs_visible` | Count Jobs/sessions that became visible. |
| `perfpulse_jobs_visibility_failed` | Count Jobs/sessions that did not become visible within the gate. |
| `perfpulse_jobs_completed` | Count Jobs/sessions that reached the required terminal state. |
| `perfpulse_jobs_completion_failed` | Count Jobs/sessions that did not complete within the gate. |
| `perfpulse_kueue_workloads_admitted` | Count Kueue Workloads admitted within the gate. |
| `perfpulse_kueue_workloads_admission_failed` | Count Kueue Workloads visible but not admitted within the gate. |
| `perfpulse_cleanup_deleted` | Count resources deleted during cleanup. |
| `perfpulse_cleanup_failed` | Count cleanup delete failures. |

### Required Custom Trends

| k6 metric name | Purpose |
| --- | --- |
| `perfpulse_submission_duration_ms` | Time spent in the create request or Kubernetes API create call. |
| `perfpulse_visibility_latency_ms` | Time from accepted create response to visible Job, Workload, or Skaha session. |
| `perfpulse_completion_latency_ms` | Time from accepted create response to terminal completion for spot workloads. |
| `perfpulse_kueue_admission_latency_ms` | Time from accepted create response to Kueue Workload admission. |

### Optional Later Metrics

These should wait until the first PoC proves cardinality and storage cost:

- `perfpulse_queue_wait_latency_ms`
- `perfpulse_skaha_status_transition`
- `perfpulse_poll_cycle_duration_ms`

### Built-in k6 Metrics to Use

The dashboards should also use built-in k6 metrics:

- `http_req_duration`
- `http_req_failed`
- `http_reqs`
- `checks`
- `iterations`
- `dropped_iterations`
- `vus`
- `data_sent`
- `data_received`

For direct Kubernetes calls and Skaha calls, set stable HTTP `name` tags such as:

- `k8s_create_job`
- `k8s_list_jobs`
- `k8s_list_workloads`
- `k8s_delete_job`
- `skaha_create_session`
- `skaha_get_session`
- `skaha_delete_session`

This avoids turning URLs with job names or session IDs into high-cardinality time series.

## Metric Labels and Kubernetes Labels

### Prometheus/k6 Tags

Allowed metric tags:

| Tag | Example | Notes |
| --- | --- | --- |
| `testid` | `spot-20260501-180000` | Unique run or campaign ID. |
| `run_class` | `spot`, `benchmark`, `stress` | Small bounded set. |
| `profile` | `spot-tiny` | Canned test profile. |
| `surface` | `k8s-kueue`, `k8s-direct`, `skaha` | Test target. |
| `scenario` | `single-bulk-user`, `many-small-users` | User-shape scenario. |
| `cohort` | `baseline`, `background`, `foreground` | Used for mixed pressure later. |
| `job_profile` | `tiny`, `small`, `standard`, `heavy` | Runtime profile. |
| `namespace` | `canfar-workloads` | Bounded namespace set. |
| `user_shape` | `1x100`, `100x1` | Bounded logical shape label. |

Forbidden metric tags:

- Job name.
- Job UID.
- Pod name.
- Session ID.
- Raw user ID.
- Full URL.
- Error message.
- Arbitrary exception text.

### Kubernetes Labels

Use Kubernetes labels for selection and cleanup. These labels may be more detailed than
Prometheus tags, but still must be bounded and predictable.

Recommended labels:

```text
app.kubernetes.io/name=perfpulse
app.kubernetes.io/managed-by=k6
perfpulse.opencadc.org/testid=<testid>
perfpulse.opencadc.org/profile=<profile>
perfpulse.opencadc.org/run-class=<run_class>
perfpulse.opencadc.org/surface=<surface>
perfpulse.opencadc.org/scenario=<scenario>
perfpulse.opencadc.org/cohort=<cohort>
perfpulse.opencadc.org/job-profile=<job_profile>
perfpulse.opencadc.org/user-bucket=<bounded bucket>
```

For Skaha/Kueue parity labels on direct Kueue Jobs:

```text
canfar-net-sessionName=perfpulse-<testid>
canfar-net-sessionType=headless
canfar-net-userid=perfpulse-bucket-<n>
opencadc.org/canfar-job-fixed=true
```

Do not use a raw session ID or job ID as a Prometheus tag.

## Thresholds and Success Gates

### First PoC Thresholds

The first PoC should use a loose but end-to-end completion gate:

- Create calls must succeed.
- The created direct Kubernetes Job must become visible within 60s.
- The created direct Kubernetes Job must complete within 120s.
- Cleanup failures must be zero.
- k6 checks must pass at a high rate.
- HTTP failure rate for Kubernetes API requests must stay below a small threshold.

The 60s visibility gate is intentionally loose. It catches broken auth, missing status
propagation, bad labels, and stuck polling without pretending the cluster baseline is already
known. The 120s completion gate gives the tiny `stress-ng` Job enough room for scheduling,
image pull, execution, status propagation, and polling without allowing a stuck path to hide.
Kueue and Skaha receive their own first-run gates when those surfaces are added.

k6 `check()` calls should provide per-request diagnostics, but thresholds must provide the
hard `TestRun` pass/fail signal. A run where every create request fails must fail even if the
script reaches `teardown()`.

### Spot Checks

Spot checks should be hard gates. They are operational sanity checks, not exploratory tests.

Spot failures should indicate:

- Kubernetes API create failed.
- Kueue Workload did not become admitted.
- Direct Job did not complete.
- Skaha session did not complete.
- Remote write did not emit expected metrics.
- Cleanup failed.

Spot profiles delete created resources by default even when a gate fails. Manual reruns may
enable preserve-on-failure for debugging, but scheduled spot checks must not accumulate failed
resources.

### Routine Benchmarks

Routine benchmarks should fail the `TestRun` when the system violates the configured benchmark
thresholds, but should avoid early abort except for catastrophic issues.

Examples of catastrophic issues:

- Authentication completely fails.
- Kubernetes API rejects every create request.
- Skaha API rejects every create request.
- Cleanup cannot run.
- The test configuration is invalid.

Benchmark baselines live in ConfigMap once benchmark profiles become gated. Until baselines
exist, benchmark profiles record comparable evidence but should not pretend guessed latency
thresholds are SLOs.

### Stress Campaigns

Stress campaigns characterize limits. They should abort only for safety failures, not because
they discovered a performance limit.

Stress success is primarily:

- Accepted work count.
- Accepted work visible within configured SLO or measured baseline.
- Error rates and rejection reasons captured.
- Cluster remains observable.
- Cleanup is complete or preserved resources are clearly labeled.

## Prometheus Remote Write

Remote write is the primary metrics path. Scrape-per-runner is not part of the v1 design.

The k6 `TestRun` should run with:

```text
-o experimental-prometheus-rw
```

Required environment:

```text
K6_PROMETHEUS_RW_SERVER_URL=<prometheus remote write URL>
K6_PROMETHEUS_RW_STALE_MARKERS=true
```

Preferred native-histogram environment:

```text
K6_PROMETHEUS_RW_TREND_AS_NATIVE_HISTOGRAM=true
```

M1 fallback environment when native histograms are not enabled on the Prometheus path:

```text
K6_PROMETHEUS_RW_TREND_STATS=p50,p95,p99
```

Optional environment:

```text
K6_PROMETHEUS_RW_PUSH_INTERVAL=5s
K6_PROMETHEUS_RW_BEARER_TOKEN=<token>
K6_PROMETHEUS_RW_USERNAME=<username>
K6_PROMETHEUS_RW_PASSWORD=<password>
K6_PROMETHEUS_RW_INSECURE_SKIP_TLS_VERIFY=false
```

Default push intervals:

- `spot-direct-tiny`: `5s`
- `spot-tiny`: `5s`
- `benchmark-small`: `5s`
- `benchmark-medium`: `5s` or `10s`
- `stress-medium`: `10s` or `15s`
- `stress-high`: `15s`

Native histogram support must be verified in the deployed Prometheus configuration before
benchmark profiles become gated. For remote write, ensure the receiver can ingest native
histograms. For Prometheus 2.x this typically means enabling the required feature flags. For
newer Prometheus versions, verify the current native histogram and remote-write receiver
configuration in ArgoCD or the deployed Prometheus config. M1 may use the `p50,p95,p99`
fallback to prove the first evidence loop while that infrastructure verification is pending.

## Dashboard Plan

M1 needs the smallest repo-managed dashboard artifact: a Grafana JSON dashboard filtered by
`testid` that shows direct Kubernetes submitted work, visible work, completed work, submission
latency, completion latency, and cleanup status.

After M2 and M3, the dashboard should become one combined PerfPulse Overview dashboard in
Grafana.

The M1 artifact should live in the repository as:

```text
docs/dashboards/perfpulse-m1-spot-direct-tiny.json
```

Variables:

- `testid`
- `run_class`
- `profile`
- `surface`
- `scenario`
- `cohort`
- `job_profile`
- `namespace`

Panels:

1. Run summary by `testid`.
2. Jobs submitted by surface.
3. Submission failures by surface.
4. Jobs visible by surface.
5. Visibility failures by surface.
6. Jobs completed or Kueue Workloads admitted by surface.
7. Completion or admission failures by surface.
8. Submission latency p50/p95/p99 by surface.
9. Visibility latency p50/p95/p99 by surface.
10. Completion or admission latency p50/p95/p99 by surface.
11. k6 dropped iterations.
12. k6 HTTP request duration and failure rate by stable request name.
13. Cleanup deleted and cleanup failures.
14. Kueue pending and admitted workloads from existing Kueue metrics.
15. Kueue controller CPU, memory, and restarts from existing cluster metrics.
16. Kubernetes API-server pressure and latency from existing Prometheus metrics.

The dashboard should be useful for both a single run and comparisons across runs. The first
version does not need to replace every old plot from `kr`; it should prove that production
Prometheus and Grafana are the new evidence system.

## Alerting Plan

v1 alerting should only cover small spot checks.

Initial alert candidates:

- No recent successful `spot-tiny` run.
- `spot-tiny` target-state failure on any enabled surface.
- `spot-tiny` cleanup failure.
- `spot-tiny` remote-write metrics missing.

Benchmark and stress profiles should not alert by default. They should be dashboarded and
reviewed manually unless a specific benchmark is later promoted to an operational SLO.

## Deployment Model

### Namespaces

Control namespace:

```text
canfar-perfpulse
```

Workload namespace:

```text
canfar-workloads
```

### k6 Operator

The cluster already has the Grafana k6 Operator installed. PerfPulse should submit k6
`TestRun` resources in `canfar-perfpulse`.

The operator-created runner Pods need:

- The PerfPulse custom image.
- A service account with Kubernetes workload permissions.
- ConfigMap environment for non-secret configuration.
- Secret environment for Skaha and Prometheus credentials.
- Resource requests/limits sized so the test runner does not become the bottleneck.

For distributed tests, `parallelism` can be increased, but the first PoC should use the
smallest safe value.

### Manual TestRun First

The first cluster milestone is manual and direct Kubernetes only:

- Apply ConfigMap.
- Apply RBAC.
- Apply one `spot-direct-tiny` TestRun.
- Verify k6 runner execution.
- Verify direct workload creation.
- Verify direct workload completion within 120s.
- Verify metrics in Prometheus/Grafana.
- Verify cleanup.

Secrets are introduced in the first milestone only if the Prometheus remote-write path requires
credentials. Skaha credentials are introduced with the Skaha surface, not before.

### CronJob Later

After the manual PoC succeeds, add a Kubernetes `CronJob` that creates `spot-tiny` TestRuns.

The CronJob should:

- Run hourly.
- Use a generated `testid`.
- Create a bounded TestRun manifest.
- Avoid overlapping runs unless explicitly allowed.
- Surface failures through k6 TestRun status and Prometheus alerts.

## Cleanup and Safety

Cleanup must have two layers.

### k6 Teardown

The k6 `teardown()` function should delete resources created by the test:

- Direct Kubernetes Jobs by test labels.
- Skaha sessions by collected session IDs.

Cleanup metrics must be emitted:

- `perfpulse_cleanup_deleted`
- `perfpulse_cleanup_failed`

### Kubernetes Safety Net

Direct Kubernetes Jobs should include:

```text
ttlSecondsAfterFinished
activeDeadlineSeconds
backoffLimit=0
```

The test should support:

```text
PRESERVE_ON_FAILURE=true
```

When enabled on manual runs, failed campaigns may leave resources for debugging, but they must
be clearly labeled with `testid`, `profile`, and `surface`. Scheduled spot checks must delete
by default even when they fail.

## User Identity Model

v1 uses synthetic logical users, not a pool of real Skaha tokens.

Direct Kubernetes Jobs can label synthetic user buckets:

```text
perfpulse-bucket-001
perfpulse-bucket-002
```

Skaha v1 uses one runtime token, so Skaha sees one real authenticated user. The many-user
shape is simulated through k6 logical user buckets and metrics, not through real Skaha
per-user auth and quota behavior.

This is acceptable for v1 because the immediate goal is to establish the harness, metrics,
dashboards, and surface comparison. Real multi-user Skaha token pools can be added later if
the benchmark must test per-user quotas, auth cost, or user-specific Skaha behavior.

## User Stories

1. As a platform operator, I want an hourly tiny spot check across direct Kueue, direct
   Kubernetes, and Skaha, so that I can see whether the core workload paths are healthy.
2. As a platform operator, I want all test metrics in production Prometheus, so that I do
   not need to inspect local CSV and plot artifacts to understand test results.
3. As a platform operator, I want Grafana dashboards for PerfPulse runs, so that I can
   compare performance across runs and surfaces.
4. As a platform operator, I want a manual first PoC TestRun, so that I can debug RBAC,
   remote write, Skaha auth, and cleanup before scheduling recurring checks.
5. As a platform operator, I want direct Kubernetes Jobs with Kueue, so that I can isolate
   Kueue admission and queue visibility behavior.
6. As a platform operator, I want direct Kubernetes Jobs without Kueue, so that I can compare
   Kueue behavior against a direct Kubernetes baseline.
7. As a platform operator, I want Skaha API driven headless sessions, so that I can measure
   the user-facing platform path rather than only raw Kubernetes behavior.
8. As a platform operator, I want stress campaigns at 10,000 and 100,000 job scale, so that
   I can characterize cluster and control-plane capacity.
9. As a platform operator, I want stress campaign success to focus on accepted and visible
   work, so that very large tests do not block on every workload completing.
10. As a platform operator, I want benchmark profiles at smaller scales, so that I can run
    performance tests regularly without creating unnecessary cluster risk.
11. As a platform operator, I want `single-bulk-user` scenarios, so that I can model one user
    launching a large queue of work.
12. As a platform operator, I want `many-small-users` scenarios, so that I can model many users
    submitting small amounts of work.
13. As a platform operator, I want mixed background and foreground pressure later, so that I
    can model small user submissions while a large queue already exists.
14. As a platform operator, I want canned profiles with constrained overrides, so that routine
    runs are consistent but stress campaigns can still be tuned deliberately.
15. As a platform operator, I want workload resources to be tiny by default, so that tests focus
    on queue and control-plane behavior unless I explicitly choose heavier resource pressure.
16. As a platform operator, I want every workload labeled by test ID, surface, profile, and
    scenario, so that cleanup and dashboards are reliable.
17. As a platform operator, I want no per-job Prometheus labels, so that high-scale tests do
    not create unbounded time series.
18. As a platform operator, I want k6 native histogram mode enabled, so that latency trends can
    be queried efficiently in Prometheus.
19. As a platform operator, I want cleanup metrics, so that failed teardown is visible as a test
    failure and an operational risk.
20. As a platform operator, I want optional preserve-on-failure mode for stress campaigns, so
    that I can debug failed high-scale runs without losing evidence immediately.
21. As a developer, I want the PerfPulse project written in TypeScript, so that the test harness
    has typed configuration, testable modules, and maintainable k6 code.
22. As a developer, I want the TypeScript bundled into JavaScript for k6, so that the runtime
    remains standard k6 while the source stays maintainable.
23. As a developer, I want stable helper modules for Kubernetes and Skaha clients, so that
    scenarios can share protocol logic without duplicating HTTP details.
24. As a developer, I want unit tests for profile parsing and manifest generation, so that large
    test profiles cannot accidentally create unsafe workloads.
25. As a developer, I want mocked API tests for Kubernetes and Skaha clients, so that request
    shapes are verified before running against the cluster.
26. As a developer, I want a minimal first PoC, so that the team can debug metrics and deployment
    before building the full scenario matrix.
27. As a release owner, I want a custom v1 image contract, so that TestRuns reference a known
    immutable runner image.
28. As a release owner, I want secrets separated from ConfigMaps, so that Skaha and Prometheus
    credentials are not committed or exposed in logs.
29. As a release owner, I want no legacy `kr` compatibility requirement, so that the repo can
    remove old Python assumptions and start cleanly.
30. As a dashboard author, I want consistent low-cardinality labels, so that Grafana variables
    work across spot, benchmark, and stress runs.

## Implementation Decisions

### Repository Direction

- Use `opencadc/perfpulse` as the implementation repository.
- Treat the old Python PerfPulse code as disposable.
- Preserve unrelated local changes while implementing the new plan.
- Do not maintain compatibility with `kr`.
- Do not port old CSV plotting scripts.
- Do not use Pushgateway as the primary metric path.

### Language and Build

- Source language: TypeScript.
- Runtime output: bundled JavaScript for k6.
- Bundler: esbuild or an equivalent simple TypeScript bundler.
- Runner image: `images.opencadc.org/platform/perfpulse:TAG`.
- The image contains the bundled k6 script and any required static assets.

### Core Modules

The implementation should be organized around these deep modules:

- Profile resolution: validates canned profiles and constrained overrides.
- k6 options builder: maps profile and scenario choices to k6 scenarios,
  thresholds, tags, and system tag policy.
- Kubernetes client: signs and sends Kubernetes API requests from k6.
- Kubernetes Job factory: builds direct and Kueue Job manifests.
- Kueue visibility tracker: polls Workloads and Jobs by labels.
- Skaha client: creates, polls, and deletes sessions.
- Metrics facade: owns custom metric definitions and tag construction.
- Cleanup manager: deletes Jobs and sessions, records cleanup metrics.

### Interfaces

The scenario layer should not know HTTP details. It should interact with simple test-domain
interfaces:

```text
createWork(surface, logicalUser, profile) -> WorkHandle
waitForVisible(workHandle, gate) -> VisibilityResult
cleanup(workHandle) -> CleanupResult
```

The implementation can expose more detailed internal types, but the scenario code should
stay close to those operations.

### Error Model

Every failed create, visibility poll, and cleanup operation should produce:

- A bounded failure category.
- A surface tag.
- A request name.
- A count metric.
- A log line with enough detail for debugging.

Failure categories should be bounded values such as:

- `auth`
- `validation`
- `rate_limited`
- `server_error`
- `timeout`
- `not_visible`
- `cleanup_failed`
- `unknown`

Raw exception messages must not become Prometheus labels.

### Run Evidence Contract

Every manual run should leave enough evidence for a later operator or developer to diagnose it
without re-running blindly:

- `testid`
- git SHA or image tag
- profile
- surface
- scenario
- executor and workload model
- thresholds used
- runner image
- target namespaces
- accepted work count
- visible work count
- completed work count
- admitted Kueue Workload count, when the Kueue surface is enabled
- cleanup result
- dashboard or Prometheus query links when available

For benchmark and stress runs, the run note should also state the active hypothesis. Examples:

- If Kueue queue depth is the bottleneck, increasing submitted work should increase visibility
  latency while API create latency stays stable.
- If API-server pressure is the bottleneck, increasing create rate should increase API request
  latency, server-side errors, or dropped k6 iterations.
- If the k6 runner is the bottleneck, increasing runner resources or distributed parallelism
  should reduce dropped iterations without changing cluster-side queue behavior.

## First PoC Scope

The first PoC is the M1 thin horizontal slice. It is intentionally narrower than `spot-tiny`.
It proves deployment, direct workload creation, metrics, Grafana queryability, and cleanup
before adding Kueue or Skaha.

### Included

- TypeScript project skeleton.
- Bundle to k6-compatible JavaScript.
- Custom runner image contract.
- Kubernetes API client using in-cluster service account credentials.
- Direct no-Kueue Job create/list/delete.
- `spot-direct-tiny` profile only.
- One TestRun manifest.
- One repo-managed Grafana dashboard JSON artifact.
- ConfigMap contract and optional Secret contract for remote-write credentials.
- Minimal RBAC.
- Remote write configuration.
- Minimal custom metrics.
- Cleanup.
- Documentation for running and verifying the PoC.

### Excluded

- Skaha runtime-token HTTP client.
- Direct Kueue Job create/list/delete.
- Skaha headless create/get/delete.
- Multi-surface `spot-tiny`.
- Full benchmark profile matrix.
- 10,000 or 100,000 job stress execution.
- CronJob scheduling.
- Alert rules.
- Token pools for real multi-user Skaha tests.
- Kubernetes watch support.
- Advanced mixed pressure scenarios.
- Full dashboard parity with every old `kr` plot.

## Test Plan

### Unit Tests

Unit tests should cover:

- Profile resolution.
- Override validation.
- k6 option generation.
- Metric tag allowlist.
- Kubernetes label generation.
- Job manifest generation for Kueue and no-Kueue surfaces.
- Skaha form parameter generation.
- Threshold generation, including completion and admission gates.
- Cleanup selection rules.
- Failure category mapping.

Tests should assert external behavior and generated contracts, not private helper details.

### Mocked Integration Tests

Mocked tests should cover:

- Kubernetes create Job success.
- Kubernetes create Job validation failure.
- Kubernetes list Jobs visibility success.
- Kueue Workload admission success and visible-but-not-admitted failure.
- Kubernetes delete cleanup success and failure.
- Skaha create session success.
- Skaha get session pending/running visibility and completed-state success.
- Skaha delete session success and failure.

### Cluster PoC Verification

The first cluster run is accepted when:

- The `TestRun` starts in `canfar-perfpulse`.
- Runner Pods use the custom image.
- The k6 runner can authenticate to the Kubernetes API.
- One direct no-Kueue Job is accepted, visible, and completed within 120s.
- Direct no-Kueue submission, visibility, completion, and cleanup metrics are emitted.
- Remote write metrics are visible in Prometheus.
- The repo-managed Grafana dashboard can filter by `testid`.
- Cleanup succeeds.

### Surface Expansion Verification

Kueue expansion is accepted when:

- One direct Kueue Job is accepted and visible.
- A corresponding Kueue Workload is admitted within the configured gate.
- Visible-but-not-admitted is a hard spot-check failure.
- Kueue metrics use the same tag allowlist as the direct Kubernetes surface.
- Direct and Kueue surfaces can run separately for isolation.

Skaha expansion is accepted when:

- The k6 runner can authenticate to Skaha with runtime-token auth.
- One Skaha headless session is accepted, visible, and completed within the configured gate.
- Skaha cleanup succeeds.
- Skaha metrics use the same tag allowlist and dashboard dimensions as the Kubernetes surfaces.

The multi-surface `spot-tiny` profile is accepted only after direct Kubernetes, Kueue, and
Skaha have each passed their independent expansion gate.

### Dashboard Verification

Dashboard verification requires:

- A visible `testid` variable.
- Submitted, visible, completed, failed, latency, and cleanup panels populated for the PoC.
- Surface-level filtering works.
- No job names, job UIDs, Pod names, session IDs, or raw user IDs appear as Prometheus labels.

## Acceptance Criteria

### PRD Acceptance

- The plan is written locally in the PerfPulse repo.
- The PRD captures current `kueuer` goals, metrics, and limitations.
- The PRD captures the new k6 architecture and decisions.
- The PRD is detailed enough for an implementation agent to start without making product
  decisions.

### First Implementation Acceptance

- `kr` is not required for PerfPulse v1.
- TypeScript builds into a k6-compatible JavaScript bundle.
- The custom image can run a local dry run and a cluster `spot-direct-tiny` test.
- Manual `spot-direct-tiny` TestRun works in `canfar-perfpulse`.
- The direct tiny workload lands in `canfar-workloads` and completes within 120s.
- Metrics arrive through Prometheus remote write.
- The repo-managed Grafana dashboard can show the first run.
- Cleanup succeeds.

### Operational Acceptance

- Hourly spot checks can be added as CronJobs after PoC.
- Benchmark and stress profiles are present but gated by explicit profile selection.
- Large stress campaigns cannot be triggered without explicit profile selection and
  `CONFIRM_STRESS=true`.
- Failure modes are visible in metrics and logs.

## Open Risks

### Prometheus Native Histogram Configuration

k6 can emit native histograms for Trend metrics, but the receiving Prometheus path must be
configured to accept them. This must be verified through ArgoCD or the deployed Prometheus
configuration.

### Skaha Resource Parity

Skaha requires minimum `cores=1` and `ram=1`, while direct Kubernetes tiny Jobs use
`100m` and `256Mi`. The v1 comparison is therefore a surface comparison, not a byte-for-byte
resource comparison.

### k6 Runner Overhead

For large stress tests, k6 runner capacity can become the bottleneck. The design mitigates
this by using bounded VUs, logical users, aggregate polling, lean metrics, and distributed
TestRuns only when needed.

### Kubernetes API Backpressure

Large create campaigns can produce API-server pressure. Stress campaigns should characterize
this pressure rather than treat it as an automatic test failure.

### Cleanup at Extreme Scale

Deleting 100,000 resources can itself be a stress event. Cleanup needs careful batching,
metrics, and TTL safety nets.

### Real Multi-User Skaha Behavior

v1 uses one runtime token and synthetic logical users. This does not test real per-user Skaha
auth, quota, or fairness behavior. Add a token-pool mode later if that becomes a requirement.

## Out of Scope

- Maintaining `kr` compatibility.
- Re-implementing old Python CSV plots.
- Pushgateway support as the main metrics path.
- Per-job Prometheus labels.
- Real multi-user Skaha token pools in v1.
- Kubernetes watch support in v1.
- Stress-high Skaha runs by default.
- Alerting on exploratory stress campaign results.

## Source Truth and References

Local source truth:

- `configs/kueue/kueuer` for prior `kr` behavior and metric semantics.
- `configs/kueue/kueuer/docs/metrics-semantics.md` for old metric interpretation.
- `configs/kueue/kueuer/src/kueuer/benchmarks/k8s.py` for old Job creation behavior.
- `configs/kueue/kueuer/src/kueuer/benchmarks/skaha/stress.py` for prior Skaha stress shape.
- `keel-deploy/helm/values/canfar.net/skaha/staging.yaml` for current staging Skaha queue
  and namespace configuration.
- `keel-deploy/helm/values/canfar.net/kueue/controller/prod.controller.yml` for deployed
  Kueue controller behavior.
- `science-platform/skaha` and `canfar` client code for Skaha session API shape and runtime
  token headers.

External references:

- Grafana k6 Operator `TestRun` execution documentation:
  <https://grafana.com/docs/k6/latest/set-up/set-up-distributed-k6/usage/executing-k6-scripts-with-testrun-crd/>
- Grafana k6 Operator `TestRun` configuration documentation:
  <https://grafana.com/docs/k6/latest/set-up/set-up-distributed-k6/usage/configure-testrun-crd/>
- Grafana k6 Prometheus remote write documentation:
  <https://grafana.com/docs/k6/latest/results-output/real-time/prometheus-remote-write/>
- Prometheus native histogram specification:
  <https://prometheus.io/docs/specs/native_histograms/>

## Further Notes

The first implementation should be intentionally boring. The value is in proving the complete
path:

```text
k6 TestRun -> Kubernetes API -> direct Job completion -> remote write -> Prometheus -> Grafana -> cleanup
```

Once that path works, add Kueue visibility, then Skaha visibility, then scheduled spot checks,
then benchmarks, then stress. The harness should make large tests possible, but the first
milestone should stay small enough to debug quickly.
