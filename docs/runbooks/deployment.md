# PerfPulse Helm Runbook

Use Helm for operator-facing PerfPulse deployment. The `cron` and `campaign` charts are the
supported deployment interface.

## Prerequisites

- `helm` with access to the target cluster.
- `kubectl` context pointed at the target cluster.
- k6 Operator installed and serving `k6.io/v1alpha1` `TestRun`.
- Prometheus or an OTLP path that accepts PerfPulse k6 metrics.
- Released PerfPulse runner image. Release Please maintains the default chart image tags.
- `canfar-perfpulse` and workload namespaces allowed by cluster policy.
- Existing Skaha credential Secret when Skaha surface is enabled.

Do not put Skaha passwords, bearer tokens, OTLP headers, or basic-auth material into Helm values.
Keep credentials in Kubernetes Secrets.

## Install Or Upgrade Cron

Permanent checks use the `cron` chart. They run Direct, Kueue, and Skaha scheduled checks by default.
The runtime taxonomy is:

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
