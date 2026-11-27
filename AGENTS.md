## Agent skills

### Issue tracker

Issues and PRDs are tracked in Jira project `CADC` through the attached Atlassian Rovo MCP. Create one `Story` per PRD and `Sub-Task` issues for the actual tasks. See `docs/agents/issue-tracker.md`.

### Triage labels

Use Jira workflow statuses for state, not triage labels. Assign created issues to Shiny Brar. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo: read root `CONTEXT.md` and `docs/adr/` when present. See `docs/agents/domain.md`.

## Learned User Preferences

- Prefers ambitious structural simplification over accepting incidental complexity when tests pass.
- Implements changes with TDD vertical slices; tests exercise public interfaces, not implementation details.
- Prefers deleting unused runtime config and orphan modules over keeping phantom switches.
- Uses Grafana as the primary evidence surface; the CANFAR dashboards live in `opencadc/science-platform` under `helm/dashboards/`, not here.
- Expects Skaha submission HTTP timeouts around 10 minutes because submissions can be slow (`SKAHA_HTTP_TIMEOUT_SECONDS`, default 600).
- Do not deploy or run ad-hoc containers in the target cluster unless explicitly asked; validate locally first.
- Prefers step-by-step cluster recovery with explicit approval between destructive or state-changing kubectl steps.

## Learned Workspace Facts

- Local verification: `uv run ruff check src tests && uv run pytest` (the chart tests need `helm` on `PATH`).
- A probe is a `@perfpulse` function; the chart runs `perfpulse <module>:<function>` once per CronJob tick. Metric names are `<function>_<key>`; every series carries `job="<installation>/perfpulse"`; built-ins are `perfpulse_probe_success` and `perfpulse_probe_duration_seconds`.
- The OTLP resource is exactly `service.namespace`, `service.name`, `service.instance.id` (built with `Resource(...)`, not `Resource.create`), so Prometheus writes no `target_info`. `MeterProvider.force_flush` returns True on a failed push, so `_push` calls the exporter directly.
- The OTel SDK's after-fork hook for a live `MeterProvider` deadlocks a forked child. The runner forks before OTel is loaded; tests run `gc.collect()` before each test for the same reason.
- OTLP export goes to Prometheus's native receiver at `http://prometheus-operated.monitoring.svc:9090/api/v1/otlp` (`:4318` is closed); queries go through Mimir at `mimir-distributed-gateway.monitoring.svc/prometheus`.
- `canfar-workloads` has node selector `skaha.opencadc.org/node-pool=cadc`; Kueue there has `manageJobsWithoutQueueName: false`, so workload probes carry the LocalQueue label (`cadc-default`, `src-default`). Sessions mount the /arc claim with `subPath: cavern`.
- Skaha bearer tokens do not expire. Intermittent session-create HTTP 404 with a GMS `resource-caps` registry lookup failure is platform-side; the response body only exists client-side, so `spawn_session` puts it in the failure detail it logs.
- Skaha allows each user 3 sessions, headless included; `spawn_session` sweeps its own leftover by name before creating one.
