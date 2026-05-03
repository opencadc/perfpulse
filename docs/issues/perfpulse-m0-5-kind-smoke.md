# PerfPulse M0.5 Kind Smoke Local Issues

Source PRD: `docs/prds/perfpulse-m0-5-kind-smoke-prd.md`

This issue breakdown is local-only. It was not published to Jira.

## Slice 1: M0 Project Scaffold and Fast Gate

- **Type**: AFK
- **Blocked by**: None
- **User stories covered**: 1, 15
- **Status**: Done

### What to build

Establish the Bun-based TypeScript project shape for PerfPulse, with one fast command that runs
linting, type checking, unit tests, and bundling before review.

### Acceptance criteria

- [x] `package.json` exposes Bun scripts for lint, typecheck, tests, build, and the combined gate.
- [x] TypeScript and Biome configuration are checked in.
- [x] CI runs the fast gate on pull requests and pushes to `main`.

## Slice 2: k6-Compatible Local No-Op Harness

- **Type**: AFK
- **Blocked by**: Slice 1
- **User stories covered**: 2, 3, 13, 17
- **Status**: Done

### What to build

Bundle the TypeScript k6 script into JavaScript that runs under k6, then prove options, thresholds,
tags, custom metrics, and local HTML summary output without Kubernetes, Prometheus, or Grafana.

### Acceptance criteria

- [x] Bun builds `src/perfpulse.ts` to `dist/perfpulse.js` with k6 imports externalized.
- [x] `bun run k6:dry-run` executes the no-op PerfPulse path under k6.
- [x] `bun run k6:dry-run:html` exports a static k6 web dashboard HTML artifact.
- [x] Unit tests cover resolved configuration, k6 options, allowed metric tags, and metric names.

## Slice 3: Custom Runner Image and Kind Smoke Command

- **Type**: AFK
- **Blocked by**: Slice 2
- **User stories covered**: 4, 5, 6, 14, 16
- **Status**: Done

### What to build

Package the built k6 bundle into a custom runner image and provide a single Kind smoke command that
expects an existing kind cluster and k6 Operator, then starts one `TestRun`.

### Acceptance criteria

- [x] `Dockerfile` packages `/test/perfpulse.js` with the k6 binary.
- [x] `bun run kind:smoke` builds and loads the custom image into kind.
- [x] The smoke command fails fast when the kind cluster or k6 Operator is unavailable.
- [x] The smoke command creates a `TestRun` in `canfar-perfpulse`.
- [x] Live k6 web-dashboard port-forwarding is optional and disabled by default.
- [x] Manual GitHub Actions Kind smoke workflow is available through `workflow_dispatch`.

## Slice 4: Direct Kubernetes Job Lifecycle

- **Type**: AFK
- **Blocked by**: Slice 3
- **User stories covered**: 7, 8, 9, 10, 11, 18
- **Status**: Done

### What to build

Run the PerfPulse Kind smoke in Kubernetes client mode so the k6 runner uses service-account auth,
creates exactly one direct no-Kueue `batch/v1` Job, observes it by PerfPulse labels, waits for
completion, and removes it during teardown.

### Acceptance criteria

- [x] The `TestRun` runner uses the `perfpulse-runner` service account.
- [x] RBAC allows direct Job create, list, get, and delete in `canfar-workloads`.
- [x] The generated Job manifest has PerfPulse labels and no Kueue queue labels.
- [x] The generated Job uses `docker.io/alexeiled/stress-ng` with a 10s tiny profile.
- [x] The k6 scenario is one bounded `shared-iterations` workload.
- [x] The runner polls visibility and completion using PerfPulse labels.
- [x] Teardown deletes the workload Job and records cleanup metrics.

## Slice 5: Kind Smoke Evidence and Cleanup Verification

- **Type**: AFK
- **Blocked by**: Slice 4
- **User stories covered**: 12, 13, 17
- **Status**: Done

### What to build

Capture diagnosis artifacts from the Kind smoke without introducing Prometheus, Grafana, Kueue,
Skaha, schedules, stress profiles, or distributed k6 runners.

### Acceptance criteria

- [x] The smoke stores `runner.log`, `testrun.describe.txt`, `workload-jobs.after.yaml`,
      `k6-web-dashboard.html`, and `web-dashboard-export.log`.
- [x] The post-cleanup workload Job state proves no labeled workload Jobs remain.
- [x] The runbook documents local M0 and M0.5 commands, prerequisites, artifacts, and live
      dashboard behavior.
- [x] The M0.5 PRD remains scoped to Kind smoke and explicitly stops before the Thin horizontal
      slice.
