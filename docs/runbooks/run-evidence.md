# PerfPulse Run Evidence

Every manual PerfPulse run should leave a Confluence-ready Markdown note keyed by `testid`.
Generate the note from structured run evidence and paste the rendered Markdown into the operator
run record or incident follow-up.

## Public Evidence Vocabulary

Use `testid` as the canonical run identity. Do not introduce `run_id`, job names, pod names,
session IDs, user IDs, or other high-cardinality values into public run evidence fields.

Required fields:

- `testid`
- `gitSha` or `imageTag`
- `profile`
- `surface`
- `scenario`
- `executor`
- `workloadModel`
- `thresholdsUsed`
- `runnerImage`
- `targetNamespaces`
- `expectedWorkCount`
- `acceptedWorkCount`
- `visibleWorkCount`
- `completedWorkCount`
- `cleanupResult`

Include `admittedKueueWorkloadCount` when the Kueue surface is enabled.
Include `campaignType` when `runClass` is `campaign`.

Include `dashboardLinks`, `prometheusLinks`, and `artifactLinks` when those links are available.

Campaign run notes must include `activeHypothesis`. Cron run notes do not require it.

## Secret Handling

Run evidence must not include bearer tokens, Skaha passwords, OTLP headers, basic-auth URLs, or
similar sensitive values. The evidence report generator rejects sensitive input instead of rendering
a redacted report, so fix the structured input and regenerate the note.

Keep credentials in Secrets and runtime-only environment values. Do not paste token headers,
OTLP credentials, or raw exception messages into run evidence.

## TypeScript Interface

Use the public evidence function from `src/evidence.ts`:

```ts
import { createRunEvidenceReport } from "./src/evidence";

const markdown = createRunEvidenceReport({
  acceptedWorkCount: 1,
  artifactLinks: [
    {
      label: "raw run archive",
      url: "https://artifacts.example.test/perfpulse/cron-20260501-180000.tar.gz",
    },
  ],
  cleanupResult: "succeeded",
  completedWorkCount: 1,
  dashboardLinks: [
    {
      label: "PerfPulse overview",
      url: "https://grafana.example.test/d/perfpulse?var-testid=cron-20260501-180000",
    },
  ],
  executor: "shared-iterations",
  expectedWorkCount: 1,
  gitSha: "abc1234",
  profile: "cron",
  prometheusLinks: [
    {
      label: "expected jobs",
      url: "https://prometheus.example.test/graph?g0.expr=perfpulse_jobs_expected%7Btestid%3D%22cron-20260501-180000%22%7D",
    },
  ],
  runClass: "cron",
  runnerImage: "ghcr.io/opencadc/perfpulse:v1",
  scenario: "single-bulk-user",
  surface: "k8s-direct",
  targetNamespaces: ["canfar-perfpulse", "canfar-workloads"],
  testid: "cron-20260501-180000",
  thresholdsUsed: ["perfpulse_jobs_submission_failed count==0"],
  visibleWorkCount: 1,
  workloadModel: "closed",
});
```

For campaign evidence, set `runClass: "campaign"`, add `campaignType: "benchmark"` or
`campaignType: "stress"`, and set `expectedWorkCount` to the selected surface's
`campaign.totalJobs` value.
