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
- Rejects large sequential campaigns by default (`TOTAL_JOBS > 100` with `LOGICAL_USERS === 1`) unless `CONFIRM_SEQUENTIAL=true`.
- Prefers deleting unused runtime config and orphan modules over keeping phantom switches.
- Uses Grafana as the primary evidence surface; offline markdown campaign reports are out of scope.
- Keeps keel-prod validation runs small (about 5–10 jobs per surface) while still tracking every job to completion.
- Expects Skaha submission HTTP timeouts around 10 minutes because submissions can be slow.
- After substantive work: transition Jira subtasks and ensure `bun run check` passes before handoff.

## Learned Workspace Facts

- Local verification: `bun run check` runs lint, typecheck, tests, and build.
- Repo-managed Grafana dashboards: `docs/dashboards/perfpulse-cron.json` (steady-state) and `docs/dashboards/perfpulse-campaign.json` (campaign drilldown); monolithic `perfpulse.json` retired.
- Unified per-job lifecycle lives in `src/work-lifecycle.ts` with surface adapters under `kubernetes/` (including Kueue) and `skaha.ts`.
- Removed from runtime: `evidence.ts`, `campaign-report.ts`, `cohort` label, `testRunGrouping`, `metricProfile`, and `job_profile`.
- Fixed workload footprint per ADR-0002: 1 CPU, 1 GiB RAM, 60s runtime — not operator-tunable in v1.
- Require completion on for cron and benchmark; optional for stress (opportunistic completion when off).
- Admission gate hard-fails on cron for Kueue only; diagnostic for benchmark and stress campaigns.
- Production validation target cluster: keel-prod.
- Helm must not emit removed runtime env vars (for example `WORKLOAD_DURATION_SECONDS`); `rejectRemovedEnv()` fails fast on boot.
