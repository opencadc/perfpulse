# PerfPulse Run Evidence

Grafana is the primary run evidence surface for PerfPulse.

## Cron checks

Use the **cron Grafana dashboard** (`docs/dashboards/perfpulse-cron.json`). The Operator Health
row shows whether recent cron checks reached target state per surface without selecting a `testid`.

## Campaigns

Use the **campaign Grafana dashboard** (`docs/dashboards/perfpulse-campaign.json`). Select
`testid` to drill into a benchmark run.

## Canonical run identity

Use `testid` everywhere: Kubernetes labels, k6 tags, dashboard variables, and operator notes.
Do not introduce separate public run IDs.

When documenting a run outside Grafana, record only low-cardinality fields:

- `testid`
- image tag or git SHA
- run class (`cron` or `benchmark`)
- surfaces exercised
- `TOTAL_JOBS` and `LOGICAL_USERS` for benchmarks
- links to the Grafana dashboard filtered by `testid`

Do not paste bearer tokens, Skaha passwords, OTLP credentials, or raw exception text into operator
notes.
