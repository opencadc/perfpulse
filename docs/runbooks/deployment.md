# PerfPulse Helm Runbook

Use Helm for operator-facing PerfPulse deployment. The `cron` and `campaign` charts are the
supported deployment interface.

## Prerequisites

- `helm` with access to the target cluster.
- `kubectl` context pointed at the target cluster.
- `k6` operator installed and serving crds `k6.io/v1alpha1` `TestRun`.
- Prometheus or an OTLP path that accepts PerfPulse k6 metrics.
- `canfar-perfpulse` and workload namespaces allowed by cluster policy. On namespace-scoped
  clusters, create or confirm `canfar-perfpulse` before running Helm or RBAC/resource checks.
  The chart does not adopt or manage the namespace. The workload namespace is always platform-owned
  and must exist before install, including when `workloadNamespace` is overridden.
- Existing Skaha credential Secret when Skaha surface is enabled.

Do not put Skaha passwords, bearer tokens, OTLP headers, or basic-auth material into Helm values.
Keep credentials in Kubernetes Secrets.

The `cron` chart creates the default `canfar-perfpulse` ServiceAccount. Campaign releases reuse that
ServiceAccount by default, so benchmark and stress releases can run while cron checks stay installed.
For a standalone campaign release, set `serviceAccount.create=true` and choose a unique
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
for resources such as CronJobs, Jobs, TestRuns, Pods, and Helm release Secrets.

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
kubectl auth can-i create testruns.k6.io --namespace canfar-perfpulse
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

Permanent checks use the `cron` chart. They run every 5 minutes across Direct, Kueue, and Skaha by
default. The runtime taxonomy is:

- `runClass=cron`
- `profile=cron`

Install or upgrade:

```bash
helm upgrade --install perfpulse-cron ./charts/cron \
  --namespace canfar-perfpulse
```

Verify the control namespace resources:

```bash
helm list --namespace canfar-perfpulse
kubectl get cronjobs,jobs,testruns,pods --namespace canfar-perfpulse
kubectl get serviceaccount,role,rolebinding --namespace canfar-perfpulse
```

Verify the workload namespace Role and RoleBinding by exact name:

```bash
kubectl get role perfpulse-cron-workload-writer --namespace canfar-workloads
kubectl get rolebinding perfpulse-cron-workload-writer --namespace canfar-workloads
kubectl describe rolebinding perfpulse-cron-workload-writer --namespace canfar-workloads
```

Cron checks are lifecycle evidence. Direct success means Job accepted, visible, and terminal. Kueue
success means Job and Workload visible, with the Job reaching a terminal state. Skaha success means
session POST accepted, visible by returned session id, and terminal. The default cron completion
timeout is 24 hours so checks can reveal resource-backlog behavior instead of failing quickly while
the cluster is full.

Each cron surface currently has one expected job. The dashboard emits and displays
`perfpulse_jobs_expected` as the denominator for acceptance, visibility failure, completion
failure, and cleanup percentages, so a failed submission still counts against the selected surface.

## Run Cron Check Manually

Trigger installed cron checks outside their schedule by creating one manual Job from each
Helm-managed CronJob. By default, the chart creates one CronJob per surface:

- `perfpulse-cron-direct`
- `perfpulse-cron-kueue`
- `perfpulse-cron-skaha`

```bash
RUN_ID="$(date -u +%Y%m%d%H%M%S)"
for SURFACE in direct kueue skaha; do
  kubectl create job "perfpulse-cron-${SURFACE}-manual-${RUN_ID}" \
    --from="cronjob/perfpulse-cron-${SURFACE}" \
    --namespace canfar-perfpulse
done
```

Watch the helper Job and the k6 `TestRun` it creates:

```bash
kubectl get jobs,testruns \
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
  --set campaign.type=benchmark \
  --set campaign.testid="${TESTID}" \
  --set campaign.totalJobs=1000 \
  --set campaign.logicalUsers=100 \
  --set campaign.confirmHighUsers=true
```

Benchmark runtime taxonomy:

- `runClass=campaign`
- `profile=campaign`
- `campaignType=benchmark`

Benchmarks use exact-job lifecycle execution. k6 runs `campaign.totalJobs` shared iterations with
up to `campaign.logicalUsers` VUs. Each VU submits one job or session, confirms it is visible, waits
until it reaches a terminal state, cleans it up, waits for jitter, and then takes the next shared
iteration. Direct and Kueue wait for Kubernetes Job `Complete` or `Failed`. Skaha uses the returned
session id and polls that session until it transitions from `Pending` or `Running` to `Completed`,
`Succeeded`, `Failed`, or `Error`.

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

The `campaign` chart renders one k6 `TestRun` for each selected surface. By default, benchmark and
stress campaigns select all three surfaces:

- `k8s-direct`
- `k8s-kueue`
- `skaha`

Those surface `TestRun`s are created by the same Helm release and run concurrently. They do not run
one after another. This is intentional: the default campaign compares Direct, Kueue, and Skaha under
the same submitted workload shape.

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
  --set campaign.type=benchmark \
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
  --set campaign.type=benchmark \
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
  --set campaign.type=benchmark \
  --set campaign.testid="${TESTID}" \
  --set campaign.totalJobs=1000 \
  --set campaign.logicalUsers=100 \
  --set campaign.confirmHighUsers=true \
  --set-json 'surfaces=["k8s-kueue"]'
```

## Run Stress Campaign

Stress can create high control-plane pressure. Run it only in an approved window and require explicit
confirmation in values.

```bash
TESTID="stress-$(date -u +%Y%m%d%H%M%S)"
helm upgrade --install perfpulse-stress ./charts/campaign \
  --namespace canfar-perfpulse \
  --set campaign.type=stress \
  --set campaign.testid="${TESTID}" \
  --set campaign.totalJobs=10000 \
  --set campaign.logicalUsers=100 \
  --set campaign.confirmHighUsers=true \
  --set campaign.confirmStress=true
```

Stress runtime taxonomy:

- `runClass=campaign`
- `profile=campaign`
- `campaignType=stress`

Stress uses the same exact-job lifecycle as benchmark, with larger sizing and explicit confirmation.
Evidence focuses on accepted work, visible work, completion, rejection categories, API-server
pressure, Kueue controller health, workload execution, Grafana visibility, and cleanup status.

## Dashboard Evidence

Use Grafana dashboard `PerfPulse Overview` and filter by:

- `testid`
- `runClass`
- `profile`
- `campaignType`
- `surface`
- `namespace`

Dashboard evidence is complete when operators can show accepted work, visible work, dropped
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

Completion is part of the success gate. A run is incomplete if expected jobs are not submitted,
visible, completed, and cleaned up for the selected surface. `Completion Latency When Observed`
requires `k6_perfpulse_jobs_completed_total` and `k6_perfpulse_completion_latency_ms_*` series for
the selected `testid`; if it is empty while cleanup succeeded, the runtime did not emit terminal
completion observations for that run.

## Uninstall Campaign Release

Remove benchmark campaign resources:

```bash
helm uninstall perfpulse-benchmark --namespace canfar-perfpulse
```

Remove stress campaign resources:

```bash
helm uninstall perfpulse-stress --namespace canfar-perfpulse
```

Keep `perfpulse-cron` installed for permanent checks unless scheduled checks are being retired.
