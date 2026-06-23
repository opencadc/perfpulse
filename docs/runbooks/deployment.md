# PerfPulse Helm Runbook

Use Helm for operator-facing PerfPulse deployment. The `cron` and `campaign` charts are the
supported deployment interface.

## Prerequisites

- `helm` with access to the target cluster.
- `kubectl` context pointed at the target cluster.
- Prometheus or an OTLP path that accepts PerfPulse k6 metrics.
- `canfar-perfpulse` and workload namespaces allowed by cluster policy. On namespace-scoped
  clusters, create or confirm `canfar-perfpulse` before running Helm or RBAC/resource checks.
  The chart does not adopt or manage the namespace. The workload namespace is always platform-owned
  and must exist before install, including when `workloadNamespace` is overridden.
- Existing Skaha credential Secret when Skaha surface is enabled.

Do not put Skaha passwords, bearer tokens, OTLP headers, or basic-auth material into Helm values.
Keep credentials in Kubernetes Secrets.

The `cron` chart creates the default `canfar-perfpulse` ServiceAccount. Benchmark releases reuse
that ServiceAccount by default, so manual benchmark runs can run while cron checks stay installed.
For a standalone benchmark release, set `serviceAccount.create=true` and choose a unique
`serviceAccount.name`.

## Create Or Confirm Namespace

Create the PerfPulse control namespace once before the first Helm install:

```bash
kubectl create namespace canfar-perfpulse
```

If the namespace may already exist, check first:

```bash
kubectl get namespace canfar-perfpulse
```

On clusters where user permissions are namespace scoped, do this before using Helm or `kubectl auth
can-i` checks for PerfPulse resources. A missing namespace can produce misleading Forbidden errors
for resources such as CronJobs, Jobs, Pods, and Helm release Secrets.

## Preflight Checks

After the control namespace exists, confirm the active namespace state and Helm release state:

```bash
kubectl get namespace canfar-perfpulse canfar-workloads
helm list --namespace canfar-perfpulse
```

Run namespace-scoped permission checks before install or upgrade:

```bash
kubectl auth can-i list secrets --namespace canfar-perfpulse
kubectl auth can-i create secrets --namespace canfar-perfpulse
kubectl auth can-i create cronjobs.batch --namespace canfar-perfpulse
kubectl auth can-i create jobs.batch --namespace canfar-perfpulse
kubectl auth can-i create roles.rbac.authorization.k8s.io --namespace canfar-perfpulse
kubectl auth can-i create rolebindings.rbac.authorization.k8s.io --namespace canfar-perfpulse
kubectl auth can-i create serviceaccounts --namespace canfar-perfpulse
```

Each `kubectl auth can-i` check should return `yes`. If Helm cannot query release state, fix that
before installing because Helm stores release metadata as Secrets in the control namespace.

## Set Up Skaha Auth

The `cron` and `campaign` charts enable the Skaha surface by default. Before installing a release
that includes Skaha, create the Skaha credential Secret in the PerfPulse control namespace:

```bash
bun run skaha-auth-setup
```

The command prompts for CANFAR username and password and applies the Secret
`perfpulse-skaha-auth` in `canfar-perfpulse`. It does not log in to Skaha and does not store a bearer
token. The runtime mounts the Secret and logs in from inside the k6 runner when it needs a Skaha
token.

Confirm the Secret exists without printing its values:

```bash
kubectl get secret perfpulse-skaha-auth --namespace canfar-perfpulse
```

To remove the Secret later:

```bash
bun run skaha-auth-cleanup
```

## Install Or Upgrade Cron

Permanent checks use the `cron` chart. They run every 10 minutes across Direct, Kueue, and Skaha by
default. The runtime taxonomy is:

- `runClass=cron`

Install or upgrade:

```bash
helm upgrade --install perfpulse-cron ./charts/cron \
  --namespace canfar-perfpulse
```

Verify the control namespace resources:

```bash
helm list --namespace canfar-perfpulse
kubectl get cronjobs,jobs,pods --namespace canfar-perfpulse
kubectl get serviceaccount,role,rolebinding --namespace canfar-perfpulse
```

Verify the workload namespace Role and RoleBinding by exact name:

```bash
kubectl get role perfpulse-cron-workload-writer --namespace canfar-workloads
kubectl get rolebinding perfpulse-cron-workload-writer --namespace canfar-workloads
kubectl describe rolebinding perfpulse-cron-workload-writer --namespace canfar-workloads
```

Cron checks are lifecycle evidence. Direct success means Job accepted and observed running. Kueue
success means Job accepted and observed running, with Workload visibility recorded separately.
Skaha success means session POST accepted and the returned session id reaches `Running` or a
successful terminal state. PerfPulse deletes the workload after target-state visibility; it does
not wait for the fixed 60 second workload completion by default.

Each cron surface currently has one expected job. The dashboard emits and displays
`perfpulse_jobs_expected` as the denominator for acceptance, visibility failure, completion
failure, and cleanup percentages, so a failed submission still counts against the selected surface.

## Run Cron Check Manually

Trigger an installed cron check outside its schedule by creating one manual Job from the
Helm-managed CronJob:

```bash
RUN_ID="$(date -u +%Y%m%d%H%M%S)"
kubectl create job "perfpulse-cron-manual-${RUN_ID}" \
  --from="cronjob/perfpulse-cron" \
  --namespace canfar-perfpulse
```

Watch the runner Job and pod:

```bash
kubectl get jobs,pods \
  --namespace canfar-perfpulse \
  --selector app.kubernetes.io/name=perfpulse
```

## Run Benchmark Campaign

Manual benchmark uses the `campaign` chart. Campaign releases are intentionally named so they can be
removed after evidence capture.

```bash
TESTID="benchmark-$(date -u +%Y%m%d%H%M%S)"
helm upgrade --install perfpulse-benchmark ./charts/campaign \
  --namespace canfar-perfpulse \
  --set campaign.testid="${TESTID}" \
  --set campaign.totalJobs=1000 \
  --set campaign.logicalUsers=100 \
  --set campaign.confirmHighUsers=true
```

Benchmark runtime taxonomy:

- `runClass=benchmark`

Benchmarks use exact-job lifecycle execution. k6 runs `campaign.totalJobs` shared iterations per
selected surface with up to `campaign.logicalUsers` VUs. Each iteration submits one job or session,
confirms it is running, deletes it, waits for jitter, and then takes the next shared iteration.
Direct and Kueue require Kubernetes Job `.status.active > 0` or successful terminal state. Skaha
uses the returned session id and polls that session until it reaches `Running` or successful
terminal state.

Campaign sizing must satisfy the jobs-per-VU cap (default `JOBS_PER_VU_CAP=500`):

```text
logicalUsers >= ceil(totalJobs / JOBS_PER_VU_CAP)
```

For example, 10,000 jobs with the default cap requires at least 20 logical users. The runner rejects
undersized campaigns and tells the operator to raise `campaign.logicalUsers` or
`campaign.jobsPerVuCap`.

Always pass a unique `campaign.testid`. Reusing a testid makes Grafana and Prometheus aggregate
separate campaign runs.

For a small Direct and Kueue validation benchmark, select those two surfaces explicitly:

```bash
TESTID="benchmark-small-$(date -u +%Y%m%d%H%M%S)"
helm upgrade --install perfpulse-benchmark-small ./charts/campaign \
  --namespace canfar-perfpulse \
  --set campaign.testid="${TESTID}" \
  --set campaign.totalJobs=10 \
  --set campaign.logicalUsers=1 \
  --set-json 'surfaces=["k8s-direct","k8s-kueue"]'
```

## Select Campaign Surfaces

The `campaign` chart renders one k6 runner Job. By default, benchmark runs select all three
surfaces:

- `k8s-direct`
- `k8s-kueue`
- `skaha`

Those surfaces run sequentially inside the same k6 runner. This keeps the default benchmark easy to
compare while avoiding overlapping OTLP exporters for one `testid`.

`campaign.totalJobs` is per selected surface, not shared across surfaces. With default surfaces and
`campaign.totalJobs=1000`, the release submits:

- 1000 Direct Kubernetes jobs
- 1000 Kueue jobs
- 1000 Skaha sessions

This same value is emitted as `perfpulse_jobs_expected` for each selected surface. Dashboard
percentage panels divide by expected jobs, not by submitted or visible jobs. For example, if a Skaha
campaign expects 100 sessions, submits 90, and sees 80 become visible, the visible percentage is
80%, not 88.9%.

Use `surfaces` for a single-surface diagnostic campaign. Skaha only:

```bash
TESTID="benchmark-skaha-$(date -u +%Y%m%d%H%M%S)"
helm upgrade --install perfpulse-skaha ./charts/campaign \
  --namespace canfar-perfpulse \
  --set campaign.testid="${TESTID}" \
  --set campaign.totalJobs=1000 \
  --set campaign.logicalUsers=100 \
  --set campaign.confirmHighUsers=true \
  --set-json 'surfaces=["skaha"]'
```

Direct Kubernetes only:

```bash
TESTID="benchmark-direct-$(date -u +%Y%m%d%H%M%S)"
helm upgrade --install perfpulse-direct ./charts/campaign \
  --namespace canfar-perfpulse \
  --set campaign.testid="${TESTID}" \
  --set campaign.totalJobs=1000 \
  --set campaign.logicalUsers=100 \
  --set campaign.confirmHighUsers=true \
  --set-json 'surfaces=["k8s-direct"]'
```

Kueue only:

```bash
TESTID="benchmark-kueue-$(date -u +%Y%m%d%H%M%S)"
helm upgrade --install perfpulse-kueue ./charts/campaign \
  --namespace canfar-perfpulse \
  --set campaign.testid="${TESTID}" \
  --set campaign.totalJobs=1000 \
  --set campaign.logicalUsers=100 \
  --set campaign.confirmHighUsers=true \
  --set-json 'surfaces=["k8s-kueue"]'
```

## Dashboard Evidence

See `docs/runbooks/run-evidence.md` for the dashboard entry points:

- cron checks use `docs/dashboards/perfpulse-cron.json`
- benchmark drilldown uses `docs/dashboards/perfpulse-campaign.json`

For campaign evidence, use the campaign dashboard and filter by:

- `testid`
- `runClass`
- `surface`
- `scenario`
- `namespace`

Dashboard evidence is complete when operators can show accepted work, running-visible work, dropped
iterations, data I/O, HTTP request rate, HTTP p95, Kubernetes API request rate, Kubernetes API p95,
and cleanup status for selected run labels.

Use the top-row `Expected Jobs` panel and the diagnosis matrix to confirm the denominator. `Target
State Reached`, `Target State Failures`, and `Cleanup` are percentages of expected jobs per
surface. Counts remain available in the diagnosis matrix. In the diagnosis matrix, `Submit failed`
is the submission deficit, `expected - submitted`, so a run that exits after submitting only part of
the expected work is visible even when no explicit submit-failed counter was emitted.

`Data IO` uses k6 byte counter metrics:

- `k6_data_sent_bytes_total`
- `k6_data_received_bytes_total`

Completion is diagnostic, not part of the default success gate. A run is incomplete if expected
jobs are not submitted, not observed running, or not cleaned up for the selected surface.
`Completion Latency When Observed` requires `k6_perfpulse_jobs_completed_total` and
`k6_perfpulse_completion_latency_ms_*` series for the selected `testid`; it can be empty for normal
benchmark runs because PerfPulse deletes workloads after running visibility.

## Uninstall Campaign Release

Remove benchmark campaign resources:

```bash
helm uninstall perfpulse-benchmark --namespace canfar-perfpulse
```

Keep `perfpulse-cron` installed for permanent checks unless scheduled checks are being retired.
