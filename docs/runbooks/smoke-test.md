# PerfPulse M0 and M0.5 Runbook

## M0: Local Harness

Install dependencies:

```bash
bun install --frozen-lockfile
```

Run the fast validation gate:

```bash
bun run check
```

Run the local k6 no-op dry run:

```bash
bun run k6:dry-run
```

Export a local k6 web dashboard HTML report:

```bash
bun run k6:dry-run:html
```

The M0 executor is `shared-iterations`, a closed-model executor, because the cron-shaped direct
smoke creates one bounded workload and exits.

The HTML export uses `K6_WEB_DASHBOARD_PERIOD=1s` so the short local validation run has enough
aggregation windows for k6 to write the report.

## M0.5: Kind Smoke

Purpose:

- Validate the k6 Operator can run the custom PerfPulse image in kind.
- Validate the runner can create, list, complete, and clean up one direct 10s `stress-ng`
  Kubernetes Job using the default workload image.
- Capture k6 web dashboard HTML and runner logs without requiring Prometheus or Grafana.

The tiny workload uses `images.canfar.net/skaha/stress-ng:latest` and the `stress-ng` command.

Prerequisites:

- `bun`
- `docker`
- `kind`
- `kubectl`
- `k6`
- A running kind cluster named `perfpulse`
- The k6 Operator already installed in that cluster

The smoke script fails fast if the `perfpulse` kind cluster or the k6 Operator `TestRun` CRD is not
available. It does not create or delete the kind cluster, and it does not install the k6 Operator.
CI should create and clean up kind through GitHub Actions setup. Local runs should keep the cluster
and operator in place for quick test and validation loops.

Run:

```bash
bun run kind:smoke
```

Artifacts are written under:

```text
artifacts/kind-smoke/<testid>/
```

The required evidence files are:

- `k6-web-dashboard.html`
- `runner.log`
- `testrun.describe.txt`
- `workload-jobs.after.yaml`
- `web-dashboard-export.log`

To open the live k6 web dashboard during the run:

```bash
K6_WEB_DASHBOARD_FORWARD=true bun run kind:smoke
```

Then open:

```text
http://127.0.0.1:5665
```

The live dashboard is optional. The runner and `TestRun` logs are the required in-cluster
evidence. The static HTML report is produced by a local k6 web-dashboard export from the same
built bundle after the `TestRun` passes, because the k6 Operator does not expose completed runner
files as durable artifacts. The smoke sets `K6_WEB_DASHBOARD_PERIOD=1s` so the tiny report run
still produces the static report.

The smoke command leaves the kind cluster, k6 Operator, namespaces, and service account in place.
It deletes the `TestRun` and verifies that no labeled workload Jobs remain after k6 teardown.
