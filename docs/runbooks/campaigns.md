# PerfPulse Campaign Evidence

Benchmark and stress campaigns are manual evidence activities. They are not scheduled cron
checks and they are not the source of official SLO or SLA gates.

Use the **campaign Grafana dashboard** (`docs/dashboards/perfpulse-campaign.json`) as the primary
evidence surface. Filter by `testid`, `surface`, and `campaign_type`.

## Benchmark Campaigns

Compare each selected surface in Grafana by:

- expected work (`k6_perfpulse_jobs_expected`)
- accepted work (`k6_perfpulse_jobs_submitted_total`)
- visible work (`k6_perfpulse_jobs_visible_total`)
- completed work (`k6_perfpulse_jobs_completed_total`)
- submission, visibility, and completion latency histograms
- dropped k6 iterations
- cleanup counters

`expected work` is the selected campaign's `campaign.totalJobs` value for that surface. Dashboard
percentage panels use it as the denominator.

Benchmark thresholds are evidence only until baselines exist. Do not describe guessed thresholds
as official SLO or SLA gates.

## Stress Campaigns

Stress campaigns require both:

- explicit stress profile selection (`campaign.type=stress`)
- `CONFIRM_STRESS=true`

Stress success evidence focuses on acceptance, visibility, observability, control-plane behavior,
and cleanup. Completion may be optional when `requireCompletion` is disabled for stress; use
`campaign_type=stress` panels that do not treat missing completion as failure.

## Preserve On Failure

When `PRESERVE_ON_FAILURE=true`, failed workloads may remain labeled with `testid`, `profile`, and
`surface` for manual follow-up. Scheduled cron checks still delete by default.
