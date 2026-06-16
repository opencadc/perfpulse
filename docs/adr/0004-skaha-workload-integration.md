# Skaha workload integration learnings

Distilled from staging validation and local debugging on **2026-06-16** after replacing
`images.canfar.net/skaha/stress-ng:latest`.

## Learnings

### Workload image

- Skaha headless sessions use `images.canfar.net/skaha/stress-ng:latest` (Ubuntu + `stress-ng`,
  includes `/bin/sh` for init containers).
- Cluster nodes on keel-prod are **linux/amd64**. The image must publish **amd64** (multi-arch
  recommended). Single-arch arm64-only images fail init with `exec /bin/sh: exec format error`.
- Build and push manually from the repo root (see README); no in-cluster image build.

### `stress-ng` command args

- PerfPulse fixed runtime args are: `--cpu 1 --temp-path /tmp --timeout 60s --metrics-brief`.
- **`--stressors` is not a stressor selector** in stress-ng 0.17 — it lists available stress
  tests and exits. Do not pass `--stressors cpu` before `--cpu`.
- Kubernetes Job args and Skaha session `args=` must use the same working form.

### Skaha session HTTP contract

- **Create:** `POST /session?<query params>`, **empty body**, headers:
  - `Authorization: Bearer <runtime token>`
  - `X-Skaha-Authentication-Type: RUNTIME-TOKEN`
  - `Content-Type: application/x-www-form-urlencoded`
  - `X-Skaha-Registry-Auth: <base64(user:pass)>` when pulling `images.canfar.net/...`
- **Create response:** plain-text session id (not JSON).
- **Poll:** `GET /session/{id}` → JSON with `status` (`Pending` → `Running` → `Completed` / …).
- **Delete:** `DELETE /session/{id}` after terminal state.
- Login: `POST https://ws-cadc.canfar.net/ac/login` with form username/password.

### Memory and CPU (Skaha API vs Kubernetes)

- Send integer **`ram=1`** and **`cores=1`** on session create (ADR-0002 fixed footprint).
- Skaha GET may still show fractional `requestedRAM` (for example `1.07`); that is server-side
  display, not the client query value. See ADR-0003.

### Operator debugging

- Reproduce from **local bash + public staging URL** before touching cluster pods.
- Use `scripts/skaha-session-smoke.sh` for a single 60s session with poll and cleanup.
- Skaha Tomcat logs: `kubectl logs --since 5m deployments/canfar-skaha-staging-skaha-tomcat -n canfar-system-staging`

## Decision

PerfPulse Skaha integration must follow the HTTP contract, registry auth, integer `ram=1`,
working `stress-ng` args, and multi-arch workload image rules above. Helm `WORKLOAD_ARGS`,
`defaultStressNgArgs()`, and Skaha session create must stay aligned.

## Consequences

- Broken `--stressors cpu` args are removed from defaults and charts.
- Skaha smoke/debug is documented in `docs/runbooks/skaha-debug.md`.
- Campaign and cron Skaha paths use the same workload args as direct Kubernetes.
