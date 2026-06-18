## Agent skills

### Issue tracker

Issues and PRDs are tracked in Jira project `CADC` through the attached Atlassian Rovo MCP. Create one `Story` per PRD and `Sub-Task` issues for the actual tasks. See `docs/agents/issue-tracker.md`.

### Triage labels

Use Jira workflow statuses for state, not triage labels. Assign created issues to Shiny Brar. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo: read root `CONTEXT.md` and `docs/adr/` when present. See `docs/agents/domain.md`.

## Learned User Preferences

- Prefers ambitious structural simplification over accepting incidental complexity when tests pass.
- Resolves design decisions via grill-with-docs-style Q&A; capture outcomes in `CONTEXT.md` and `docs/adr/`.
- Implements changes with TDD vertical slices; tests exercise public interfaces, not implementation details.
- Rejects campaigns where `logicalUsers < ceil(totalJobs / jobsPerVuCap)`; operator raises `LOGICAL_USERS` or `JOBS_PER_VU_CAP`.
- Prefers deleting unused runtime config and orphan modules over keeping phantom switches.
- Uses Grafana as the primary evidence surface; offline markdown campaign reports are out of scope.
- Keeps keel-prod validation runs small (about 5–10 jobs per surface) while still tracking every job to completion.
- Expects Skaha submission HTTP timeouts around 10 minutes because submissions can be slow.
- After substantive work: transition Jira subtasks and ensure `bun run check` passes before handoff.
- Do not deploy or run ad-hoc containers in the target cluster unless explicitly asked; validate workload images locally with docker and debug Skaha from local bash and server logs first.
- Prefers step-by-step cluster recovery with explicit approval between destructive or state-changing kubectl steps.
- Wants preventive chart/repo backstops (cron overlap gate, per-testid OTLP service name)—not only one-off cluster cleanup.

## Learned Workspace Facts

- Local verification: `bun run check` runs lint, typecheck, tests, and build.
- Repo-managed Grafana dashboards: `docs/dashboards/perfpulse-cron.json` (steady-state) and `docs/dashboards/perfpulse-campaign.json` (campaign drilldown); monolithic `perfpulse.json` retired.
- Default per-job lifecycle lives in `src/work-lifecycle.ts` with surface adapters under `kubernetes/` (including Kueue) and `skaha.ts`; Skaha stress uses bulk submit/poll/delete in `runBulkSkahaStressSurface` per ADR-0005. Observation for each workload begins at accept time.
- Removed from runtime: `evidence.ts`, `campaign-report.ts`, `cohort` label, `testRunGrouping`, `metricProfile`, and `job_profile`.
- Fixed workload footprint per ADR-0002: 1 CPU, 1 GiB RAM, 60s runtime — not operator-tunable in v1.
- Require completion on for cron and benchmark; optional for stress (opportunistic completion when off).
- Admission gate hard-fails on cron for Kueue only; diagnostic for benchmark and stress campaigns.
- Production validation on keel-prod deploys to `canfar-perfpulse` (`perfpulse-cron`, `perfpulse-benchmark` Helm releases).
- Cron chart `cronGate` skips new TestRuns while an active runner Job exists per surface; optional preempt; prunes prior surface TestRuns before create.
- Runner pods set `K6_OTEL_SERVICE_NAME=perfpulse-${TESTID}`; OTLP export to `kube-prometheus-stack-prometheus.monitoring:9090`; overlapping exporters cause Prometheus out-of-order-sample rejections; k6 has no env to cap export retries.
- `canfar-workloads` node selector `skaha.opencadc.org/node-pool=cadc` constrains direct and Kueue scheduling; Kueue cron uses low priority and admission can exceed long completion timeouts on busy clusters.
- Helm must not emit removed runtime env vars (for example `WORKLOAD_DURATION_SECONDS`); `rejectRemovedEnv()` fails fast on boot. Skaha session `ram` whole GiB integer per ADR-0003; workload image `images.canfar.net/skaha/stress-ng:latest` from `docker/stress-ng/Dockerfile` (README: plain local `docker build` / `docker push` only); integration ADR-0004.
