# Benchmark-only running visibility lifecycle

PerfPulse was drifting into three public modes: cron, benchmark, and stress. That made the code
carry two lifecycle models, dashboard special cases, and a Skaha-only bulk path even though the
actual requirement is simpler: deposit `N` workloads, prove they were accepted, prove they were
actually scheduled, then delete them.

## Decision

- Keep only two run classes: `cron` and `benchmark`.
- Keep the same three test surfaces: direct Kubernetes Job, Kueue-backed Kubernetes Job, and
  Skaha session API.
- Run every surface through the same per-job lifecycle.
- Treat **running visibility** as the target state:
  - Direct Kubernetes and Kueue Jobs require `status.active > 0` or terminal success.
  - Skaha sessions require `Running` or terminal success.
- Default `REQUIRE_COMPLETION` to false. A benchmark does not wait for the fixed 60s workload
  runtime unless an operator explicitly asks for completion evidence.
- Use native k6 runner `Job` and `CronJob` resources instead of generating operator custom
  resources from Helm.

## Consequences

- Benchmark campaigns can exceed cluster capacity without waiting for all jobs to complete.
- Scheduler pressure is measured as submit latency, running visibility latency, and cleanup,
  with completion retained as diagnostic evidence.
- Kueue admission remains useful evidence, but it is not the target-state gate.
- Large benchmark safety is controlled by `jobsPerVuCap` validation rather than a separate stress
  mode.
- Dashboards and metrics use `run_class`, not `profile` or `campaign_type`.
