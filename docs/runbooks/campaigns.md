# PerfPulse Benchmark Evidence

Benchmark campaigns are manual evidence activities. They are not scheduled cron checks and they are
not the source of official SLO or SLA gates.

Use the **campaign Grafana dashboard** (`docs/dashboards/perfpulse-campaign.json`) as the primary
evidence surface. Filter by `testid`, `runClass`, `surface`, `scenario`, and `namespace`.

## Benchmark Campaigns

Compare each selected surface in Grafana by:

- expected work (`k6_perfpulse_jobs_expected`)
- accepted work (`k6_perfpulse_jobs_submitted_total`)
- visible work (`k6_perfpulse_jobs_visible_total`)
- completed work (`k6_perfpulse_jobs_completed_total`) when observed
- submission and visibility latency histograms
- completion latency histograms when `REQUIRE_COMPLETION=true` or completion is observed during
  visibility polling
- dropped k6 iterations
- cleanup counters

`expected work` is the selected campaign's `campaign.totalJobs` value for that surface. Dashboard
percentage panels use it as the denominator.

Benchmark thresholds are evidence only until baselines exist. Do not describe guessed thresholds
as official SLO or SLA gates.

## Large Benchmarks

Campaign sizing must satisfy the jobs-per-VU cap (default `JOBS_PER_VU_CAP=500`):

```text
logicalUsers >= ceil(totalJobs / JOBS_PER_VU_CAP)
```

Large benchmark success evidence focuses on acceptance, running visibility, observability,
control-plane behavior, and cleanup. Completion is diagnostic by default because PerfPulse deletes
workloads after target-state visibility.

## Preserve On Failure

When `PRESERVE_ON_FAILURE=true`, failed workloads may remain labeled with `testid`, `runClass`, and
`surface` for manual follow-up. Scheduled cron checks still delete by default.
