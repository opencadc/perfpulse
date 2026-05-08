# PerfPulse Helm Runbook

Use Helm for operator-facing PerfPulse deployment. The `cron` and `campaign` charts are the
supported deployment interface.

## Prerequisites

- `helm` with access to the target cluster.
- `kubectl` context pointed at the target cluster.
- k6 Operator installed and serving `k6.io/v1alpha1` `TestRun`.
- Prometheus or an OTLP path that accepts PerfPulse k6 metrics.
- Released PerfPulse runner image. Release Please maintains the default chart image tags.
- `canfar-perfpulse` and workload namespaces allowed by cluster policy. The Helm command can create
  `canfar-perfpulse` when it is missing; the chart does not adopt or manage a pre-existing namespace.
  The workload namespace is always platform-owned and must exist before install, including when
  `workloadNamespace` is overridden.
- Existing Skaha credential Secret when Skaha surface is enabled.

Do not put Skaha passwords, bearer tokens, OTLP headers, or basic-auth material into Helm values.
Keep credentials in Kubernetes Secrets.

The `cron` chart creates the default `canfar-perfpulse` ServiceAccount. Campaign releases reuse that
ServiceAccount by default, so benchmark and stress releases can run while cron checks stay installed.
For a standalone campaign release, set `serviceAccount.create=true` and choose a unique
`serviceAccount.name`.

## Install Or Upgrade Cron

Permanent checks use the `cron` chart. They run every 5 minutes across Direct, Kueue, and Skaha by
default. The runtime taxonomy is:

- `runClass=cron`
- `profile=cron`

Install or upgrade:

```bash
helm upgrade --install perfpulse-cron ./charts/cron \
  --namespace canfar-perfpulse \
  --create-namespace
```

Cron checks are acceptance evidence. Direct success means Job accepted and visible. Kueue success
means Workload visible. Skaha success means session POST accepted and visible or discoverable.
Completion is evidence, not the success gate.

## Run Cron Check Manually

Trigger an installed cron check outside its schedule by creating a Job from the Helm-managed
CronJob. Choose one surface:

- `direct`
- `kueue`
- `skaha`

```bash
SURFACE=direct
RUN_ID="$(date -u +%Y%m%d%H%M%S)"
kubectl create job "perfpulse-cron-${SURFACE}-manual-${RUN_ID}" \
  --from="cronjob/perfpulse-cron-${SURFACE}" \
  --namespace canfar-perfpulse
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
helm upgrade --install perfpulse-benchmark ./charts/campaign \
  --namespace canfar-perfpulse \
  --set campaign.type=benchmark \
  --set campaign.totalJobs=1000 \
  --set campaign.logicalUsers=100 \
  --set campaign.confirmHighUsers=true
```

Benchmark runtime taxonomy:

- `runClass=campaign`
- `profile=campaign`
- `campaignType=benchmark`

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

Use `surfaces` for a single-surface diagnostic campaign. Skaha only:

```bash
helm upgrade --install perfpulse-skaha ./charts/campaign \
  --namespace canfar-perfpulse \
  --set campaign.type=benchmark \
  --set campaign.totalJobs=1000 \
  --set campaign.logicalUsers=100 \
  --set campaign.confirmHighUsers=true \
  --set-json 'surfaces=["skaha"]'
```

Direct Kubernetes only:

```bash
helm upgrade --install perfpulse-direct ./charts/campaign \
  --namespace canfar-perfpulse \
  --set campaign.type=benchmark \
  --set campaign.totalJobs=1000 \
  --set campaign.logicalUsers=100 \
  --set campaign.confirmHighUsers=true \
  --set-json 'surfaces=["k8s-direct"]'
```

Kueue only:

```bash
helm upgrade --install perfpulse-kueue ./charts/campaign \
  --namespace canfar-perfpulse \
  --set campaign.type=benchmark \
  --set campaign.totalJobs=1000 \
  --set campaign.logicalUsers=100 \
  --set campaign.confirmHighUsers=true \
  --set-json 'surfaces=["k8s-kueue"]'
```

## Run Stress Campaign

Stress can create high control-plane pressure. Run it only in an approved window and require explicit
confirmation in values.

```bash
helm upgrade --install perfpulse-stress ./charts/campaign \
  --namespace canfar-perfpulse \
  --set campaign.type=stress \
  --set campaign.totalJobs=10000 \
  --set campaign.logicalUsers=100 \
  --set campaign.confirmHighUsers=true \
  --set campaign.confirmStress=true
```

Stress runtime taxonomy:

- `runClass=campaign`
- `profile=campaign`
- `campaignType=stress`

Stress evidence focuses on accepted work, visible work, rejection categories, API-server pressure,
Kueue controller health, workload execution, Grafana visibility, and cleanup status. Completion is
recorded when available.

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

Completion is evidence, not the success gate.

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
