# PerfPulse Campaign Evidence

Benchmark and stress campaigns are manual evidence activities. They are not scheduled cron
checks and they are not the source of official SLO or SLA gates.

Use `src/campaign-report.ts` to turn structured campaign input into a Confluence-ready Markdown
report. The report generator rejects sensitive input instead of rendering secrets.

## Benchmark Campaigns

Benchmark reports compare each selected surface by:

- expected work
- accepted work
- visible work
- visible percentage of expected work
- p50, p95, and p99 latency
- dropped k6 iterations
- cleanup status
- relevant cluster metrics

`expected work` is the selected campaign's `campaign.totalJobs` value for that surface. It is the
same denominator used by the Grafana dashboard's surface percentage panels.

The structured input must state whether baselines exist. When baselines do not exist, benchmark
thresholds are evidence only. Do not describe guessed thresholds as official SLO or SLA gates.

## Stress Campaigns

Stress reports are runnable only when the structured input includes both:

- `explicitProfileSelection: true`
- `confirmStress: true`

Stress success evidence focuses on:

- expected work
- accepted work
- visible work
- visible percentage of expected work
- rejection categories
- dropped iterations
- API-server pressure
- Kueue controller health
- workload execution
- Grafana visibility
- cleanup status

Completion is recorded in a secondary section because large stress campaigns are primarily about
acceptance, visibility, observability, control-plane behavior, and cleanup.

## Preserve On Failure

Every campaign report states whether preserve-on-failure is enabled or disabled.

When enabled, the structured input must include labels for:

- `testid`
- `profile`
- `surface`

These labels are required so preserved resources can be found, reviewed, and cleaned up.

## Later Mixed Pressure Profile

Mixed background and foreground pressure is represented as a later profile model, not a runnable
campaign. The model must include an active hypothesis and both cohort labels:

- `background`
- `foreground`
