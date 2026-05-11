# PerfPulse Helm CI/CD and Campaign Runtime PRD

## Problem Statement

PerfPulse has reached the point where the existing deployment model is harder to operate than the
product it is meant to support. The repository contains many static Kubernetes manifests for
individual profiles and milestones, and the deployment runbook asks operators to understand and
edit YAML before running routine checks or manual campaigns. This makes the product harder to
trust, harder to release, and harder to reuse safely.

Operators need a simple production-facing model:

1. Install permanent checks once.
2. Run manual campaigns by passing a small number of values.
3. View the results in Grafana using the same language as the deployment interface.

The current runtime taxonomy does not match that model. PerfPulse currently treats `spot`,
`benchmark`, and `stress` as top-level run classes. The desired operator interface is simpler:
`cron` for permanent scheduled checks, and `campaign` for manual benchmark or stress work. The
dashboard, runtime tags, Helm values, and runbook should all use that language consistently.

The current campaign model is also too static. Operators should not choose between fixed
`benchmark-small`, `benchmark-medium`, `stress-medium`, and `stress-high` manifests when the
actual decision they want to make is simple: how many jobs should this run submit, and how many
logical users should submit them? For example, if a campaign uses 2,500 jobs and 25 logical users,
each logical user should submit 100 jobs sequentially. That shape is easy to reason about and easy
to reproduce.

The current static manifests also make Release Please less useful. A release should update the
versioned runner image used by the deployment interface. Instead, every static manifest becomes
another place where stale image tags can remain. The release automation should pin the default
chart image tag and chart versions in one place.

Finally, the current Grafana dashboard has missing signals that need to be fixed as part of this
cleanup. The k6 runtime panels for dropped iterations and data I/O are not producing data in the
observed dashboard, and the Kubernetes API server request-rate and p95 latency panels are also not
producing data. Since the dashboard taxonomy is changing anyway, this is the right moment to fix
those PromQL contracts and make the dashboard match the new runtime model.

## Solution

Replace the static-manifest deployment model with two repo-local Helm charts:

1. `cron`: the permanent scheduled-check deployment.
2. `campaign`: the manual benchmark and stress campaign deployment.

The Helm charts are the canonical operator interface. Bun remains the TypeScript toolchain for
installing dependencies, linting, type checking, unit testing, building the k6 bundle, and running
local dry runs. There should not be a new Bun operator CLI or `bunx` deployment interface.

The `cron` chart installs a permanent 5-minute check. It creates one Kubernetes CronJob per
enabled surface. The default enabled surfaces are Direct Kubernetes, Kueue, and Skaha. Each CronJob
creates the appropriate k6 Operator `TestRun` for its surface. Surface isolation is intentional:
operators should be able to see whether Direct, Kueue, or Skaha is failing without unpacking one
fan-out job.

The `campaign` chart launches one manual campaign as a Helm release. Operators pass `totalJobs`
and `logicalUsers` at install time. `totalJobs` is per selected surface, not shared across
surfaces. If a campaign selects all three surfaces with `totalJobs=2500`, the campaign submits
2,500 Direct jobs, 2,500 Kueue jobs, and 2,500 Skaha sessions. This preserves apples-to-apples
surface comparison.

Every run emits expected work as `perfpulse_jobs_expected`. For cron, expected work is currently one
job per enabled surface. For campaigns, expected work is `totalJobs` for each selected surface.
Dashboard percentages use expected work as the denominator so failed submissions remain visible in
surface health.

Runtime taxonomy changes to:

- `runClass=cron`
- `runClass=campaign`

Campaign runs also carry:

- `campaignType=benchmark`
- `campaignType=stress`

The old canned profile taxonomy is replaced by:

- `profile=cron`
- `profile=campaign`

Campaign scale is represented by `totalJobs`, `logicalUsers`, `userShape`, and `campaignType`,
not by profile names such as `benchmark-medium` or `stress-high`.

The success model changes from completion-gated to acceptance-gated. Completion remains useful
evidence, but it is no longer a hard pass/fail requirement for cron or campaign runs. This matters
because large campaigns may intentionally submit more work than the cluster can complete quickly.
For example, a 100,000-job campaign on a cluster with roughly 10,000 cores may take a long time to
finish. The campaign should answer whether the platform accepted and queued the work, not fail
because all submitted work did not finish inside the observation window.

Acceptance means:

- Direct Kubernetes: the Job create request succeeds and the Job becomes visible.
- Kueue: the Job create request succeeds and the corresponding Kueue Workload becomes visible.
- Skaha: the session POST succeeds and returns a recognizable visible or Pending platform state.

The `cron` workload uses a 60-second `stress-ng` runtime from the released PerfPulse image.
PerfPulse may observe for up to 10 minutes because queueing or platform delay can dominate. The
10-minute observation window should not imply that workload completion is a hard gate.

All pods created by the Helm path should use the same released PerfPulse image: the cron helper,
k6 Operator initializer/starter/runner pods, and the bounded workload pods or Skaha sessions. The
image includes `k6`, `kubectl`, and `stress-ng` so chart users do not need separate helper or
workload images.

Release Please updates the package version, chart version, chart app version, and chart image tag.
The chart default image tag should match the release tag, for example `v0.1.8`. Digest pinning is
out of scope for this PRD because the digest is only known after the image build. Version-tag
pinning is enough for the immediate release and runbook simplification.

The deployment runbook should become a short Helm-based operator guide:

1. Install or upgrade permanent cron checks.
2. Launch a benchmark campaign.
3. Launch a stress campaign with explicit confirmation.
4. Inspect dashboard evidence.
5. Uninstall a campaign release when cleanup is needed.

## User Stories

1. As a platform operator, I want to deploy permanent PerfPulse checks with a Helm command, so
   that deployment follows standard Kubernetes practice.
2. As a platform operator, I want a `cron` chart, so that scheduled checks are clearly separated
   from manual campaigns.
3. As a platform operator, I want a `campaign` chart, so that benchmark and stress runs share one
   manual run interface.
4. As a platform operator, I want the `cron` chart to run every 5 minutes, so that Grafana has
   fresh operational evidence.
5. As a platform operator, I want one CronJob per surface, so that Direct, Kueue, and Skaha
   failures are isolated in Kubernetes history.
6. As a platform operator, I want Direct, Kueue, and Skaha enabled by default for cron checks, so
   that the scheduled check covers the baseline, dependency, and user-facing surfaces.
7. As a platform operator, I want cron checks to use a 60-second workload, so that the check is
   small but still exercises real workload scheduling.
8. As a platform operator, I want cron checks to observe for up to 10 minutes, so that expected
   queue delay does not create false failures.
9. As a platform operator, I want cron success to be based on platform acceptance, so that a full
   cluster does not fail a check only because completion is delayed.
10. As a platform operator, I want Direct cron success to mean a Job is created and visible, so
    that the Kubernetes API and Job lifecycle are proven.
11. As a platform operator, I want Kueue cron success to mean a Workload is visible, so that queue
    acceptance is proven without requiring admission under capacity pressure.
12. As a platform operator, I want Skaha cron success to mean a session POST returns a visible or
    Pending state, so that the user-facing platform path is proven.
13. As a platform operator, I want completion latency recorded when available, so that the
    dashboard can still show how long work took after acceptance.
14. As a platform operator, I want completion to be evidence only, so that large campaigns do not
    fail on expected capacity limits.
15. As a platform operator, I want to run a campaign by passing `totalJobs`, so that I do not edit
    Kubernetes manifests for every run size.
16. As a platform operator, I want to run a campaign by passing `logicalUsers`, so that submission
    concurrency is explicit.
17. As a platform operator, I want `totalJobs` to be per surface, so that selected surfaces are
    compared using the same workload count.
18. As a platform operator, I want `totalJobs` to divide evenly across `logicalUsers`, so that
    every logical user has the same number of sequential submissions.
19. As a dashboard user, I want expected work emitted per surface, so that acceptance, visibility
    failure, and cleanup percentages are based on planned work rather than only submitted work.
20. As a platform operator, I want invalid job/user shapes rejected before work is created, so
    that a bad campaign configuration does not partially run.
21. As a platform operator, I want each logical user to submit its jobs sequentially, so that the
    user shape is predictable and does not create a hidden parallel burst.
22. As a platform operator, I want logical users above 25 to require confirmation, so that high
    concurrency is intentional.
23. As a platform operator, I want more than 10,000 jobs per surface to require a stress campaign,
    so that large quiet-window work is not launched as a normal benchmark.
24. As a platform operator, I want stress campaigns to require explicit stress confirmation, so
    that high-load runs are deliberate.
25. As a platform operator, I want benchmark and stress to be campaign types, so that the public
    model stays small without losing dashboard grouping.
26. As a platform operator, I want a campaign release to be uninstallable with Helm, so that
    cleanup is auditable and standard.
27. As a platform operator, I want surface selection to be configurable, so that I can run all
    surfaces for comparison or a single surface for diagnosis.
28. As a platform operator, I want all surfaces selected by default for campaigns, so that the
    common path compares Direct, Kueue, and Skaha without extra values.
29. As a release owner, I want Release Please to update chart versions, so that the chart version
    matches the application release.
30. As a release owner, I want Release Please to update chart app versions, so that Helm metadata
    reflects the released runner.
31. As a release owner, I want Release Please to update chart image tags, so that deployers use
    the released container image by default.
32. As a release owner, I want version-tag pinning, so that release PRs can update chart values
    before image build completion.
33. As a maintainer, I want static rendered manifests removed, so that the chart is the source of
    truth.
34. As a maintainer, I want chart rendering validated in CI, so that deleting static manifests
    does not reduce deployment safety.
35. As a maintainer, I want the kind proof-of-concept workflow removed from maintained CI, so that
    CI reflects the production deployment path.
36. As a maintainer, I want Bun to remain only the TypeScript tooling layer, so that deployment
    behavior does not depend on a custom CLI.
37. As a developer, I want runtime config tests for `cron` and `campaign`, so that old profile
    names cannot silently reappear.
38. As a developer, I want safety-gate tests for campaign sizes and logical users, so that high
    load cannot be triggered accidentally.
39. As a developer, I want chart tests for RBAC and security contexts, so that Helm output keeps
    the production admission contract.
40. As a dashboard user, I want Grafana filters for `runClass=cron|campaign`, so that dashboard
    language matches the deployment model.
41. As a dashboard user, I want Grafana filters for `campaignType`, so that benchmark and stress
    campaigns can be separated.
42. As a dashboard user, I want dropped iterations to show data when k6 emits it, so that runner
    pressure is visible.
43. As a dashboard user, I want data I/O to show data when k6 emits it, so that network behavior
    is visible.
44. As a dashboard user, I want Kubernetes API request rate to show data, so that control-plane
    pressure is visible.
45. As a dashboard user, I want Kubernetes API p95 latency to show data, so that API-server
    latency is visible.
46. As a platform maintainer, I want the deployment runbook reduced to Helm commands, so that
    operators can run PerfPulse without learning the full manifest internals.
47. As a platform maintainer, I want prerequisites documented separately, so that PerfPulse does
    not accidentally become responsible for installing the k6 Operator or shared platform
    namespaces.
48. As a platform maintainer, I want the control namespace managed by the chart, so that the
    PerfPulse deployment can be installed predictably.
49. As a platform maintainer, I want the workload namespace treated as platform-owned, so that a
    PerfPulse release does not claim shared cluster resources.
50. As a platform maintainer, I want Skaha credentials kept as a prerequisite Secret, so that
    charts do not store or create sensitive credentials.
51. As a platform maintainer, I want metrics credentials kept out of ConfigMaps, so that the
    existing secret-handling discipline remains intact.

## Implementation Decisions

### Deployment Interface

- Helm is the canonical operator interface.
- The repository provides two local charts: `cron` and `campaign`.
- Charts are consumed from the Git checkout for this milestone.
- Publishing charts to an OCI registry or GitHub Release artifact is not part of this PRD.
- Operators should not use a new Bun command or `bunx` command to deploy PerfPulse.
- Bun remains responsible for TypeScript project work only.

### Chart Ownership

- The `cron` chart owns permanent scheduled checks.
- The `campaign` chart owns manual one-off benchmark and stress runs.
- The charts create or manage the PerfPulse control namespace path.
- The workload namespace remains a platform-owned prerequisite.
- The charts assume the k6 Operator is already installed.
- The charts assume Kueue, Prometheus OTLP ingestion, Grafana, and Skaha are already provided by
  the platform.
- The charts assume the Skaha credential Secret is created through the existing authentication
  setup flow or platform secret management.

### Cron Chart Behavior

- The `cron` chart runs on a 5-minute cadence.
- Direct, Kueue, and Skaha are enabled by default.
- Each enabled surface renders a separate Kubernetes CronJob.
- Each CronJob creates one k6 Operator `TestRun` for its surface.
- CronJobs should not overlap by default.
- Cron-generated test IDs must be stable enough for Grafana filtering and cleanup.
- The cron workload duration is 60 seconds.
- The cron observation window is up to 10 minutes.
- The cron success model is platform acceptance, not completion.
- Completion metrics remain useful but do not define the hard gate.
- Cron emits one expected job per enabled surface.

### Campaign Chart Behavior

- A campaign is launched as a Helm release.
- `totalJobs` is required for every campaign run.
- `logicalUsers` is required for every campaign run.
- `totalJobs` is interpreted per selected surface.
- Each selected surface emits `perfpulse_jobs_expected=totalJobs`.
- The default selected surfaces are Direct, Kueue, and Skaha.
- Operators can override surfaces for targeted diagnosis.
- `totalJobs` must divide evenly across `logicalUsers`.
- Each logical user submits its assigned jobs sequentially.
- Campaign success is platform acceptance, not completion.
- Completion is recorded when available and should appear in evidence.
- A campaign release should be removable with standard Helm uninstall semantics.

### Campaign Safety Gates

- `logicalUsers > 25` requires an explicit high-user confirmation value.
- `totalJobs > 10000` per selected surface requires `campaignType=stress`.
- Stress campaigns require explicit stress confirmation.
- Invalid safety-gate combinations must fail before any workload is created.
- Benchmark campaigns should remain the normal manual evidence path.
- Stress campaigns should remain rare, explicit, and quiet-window oriented.

### Runtime Taxonomy

- Replace `runClass=spot|benchmark|stress` with `runClass=cron|campaign`.
- Add `campaignType=benchmark|stress` for campaign runs.
- Replace canned profile names with `profile=cron|campaign`.
- Preserve surface names: Direct Kubernetes, Kueue, and Skaha remain the test surfaces.
- Preserve logical user terminology.
- Preserve job profile terminology only where it still describes workload duration or shape.
- Runtime labels, metric tags, dashboard variables, run evidence, and reports should use the new
  taxonomy.
- Runtime evidence should expose expected work beside accepted, visible, completed, and cleanup
  counts.

### Acceptance Gates

- Direct Kubernetes acceptance means the Job create request succeeds and the Job becomes visible.
- Kueue acceptance means the Job create request succeeds and the corresponding Kueue Workload is
  visible.
- Skaha acceptance means the session POST succeeds and returns a recognizable visible or Pending
  platform state.
- Kueue admission is measured separately and can be displayed as evidence.
- Workload completion is measured separately and can be displayed as evidence.
- Completion should not be required for cron or campaign success.
- Cleanup failures should still be visible and should remain a safety signal.

### Release Please

- Release Please updates the package version.
- Release Please updates chart `version`.
- Release Please updates chart `appVersion`.
- Release Please updates chart default image tag.
- The default image tag follows the release tag shape, for example `v0.1.8`.
- Release Please should use arbitrary file updates for YAML chart files.
- Digest pinning is out of scope for this milestone.

### CI/CD

- CI uses `bun ci` for deterministic dependency installation.
- CI runs linting, type checking, unit tests, bundle build, and the local k6 dry run.
- CI validates Helm charts with linting and template rendering.
- CI validates the Docker image can build.
- The release image workflow keeps multi-architecture image publication.
- The release image workflow keeps SBOM, provenance, and signing behavior.
- The kind proof-of-concept workflow is removed from the maintained CI path.

### Static Manifest Cleanup

- Static rendered deployment manifests are removed as deployable artifacts.
- Tests replace static YAML files as the contract for rendered resources.
- Documentation no longer asks operators to edit static manifests.
- The deployment runbook points to Helm commands and values.

### Dashboard Updates

- Grafana dashboard variables use the new runtime taxonomy.
- Dashboard filters include `runClass` and `campaignType`.
- Dashboard panels query `profile=cron|campaign`.
- Dropped-iteration panels must use the actual k6 metric names exported through the active OTLP
  to Prometheus path.
- Data I/O panels must use the actual k6 metric names exported through the active OTLP to
  Prometheus path.
- API server request panels must use Kubernetes API-server metric labels that match the deployed
  Prometheus series.
- API server latency panels must use Kubernetes API-server metric labels that match the deployed
  Prometheus series.

### Runbook Updates

- The deployment runbook becomes a concise Helm guide.
- The runbook includes one command to install or upgrade cron checks.
- The runbook includes one command to run a benchmark campaign.
- The runbook includes one command to run a stress campaign with confirmation.
- The runbook includes one command to uninstall a campaign release.
- The runbook documents prerequisites without embedding their installation.
- The runbook makes clear that completion is evidence, not the success gate.

## Testing Decisions

Tests should validate external behavior and public contracts. They should not assert every
template indentation detail or internal helper implementation. The core question for every test is
whether an operator, release owner, dashboard user, or maintainer sees the promised behavior.

### Runtime Configuration Tests

Runtime configuration tests should cover:

- Default local no-op configuration still works for developer dry runs.
- `profile=cron` resolves to `runClass=cron`.
- `profile=campaign` resolves to `runClass=campaign`.
- Campaigns require `totalJobs`.
- Campaigns require `logicalUsers`.
- Campaigns reject uneven job distribution.
- Campaigns accept even job distribution.
- Campaigns default to all surfaces.
- Campaigns allow explicit surface overrides.
- Campaigns reject high logical user counts without confirmation.
- Campaigns accept high logical user counts with confirmation.
- Campaigns reject large job counts unless they are stress campaigns.
- Stress campaigns require stress confirmation.
- Cron uses 60-second workload duration.
- Cron uses the configured observation window.
- Runtime labels and metric tags include `runClass`, `profile`, and `campaignType` where
  appropriate.

### k6 Options Tests

k6 options tests should cover:

- Cron uses a bounded closed-model executor suitable for small scheduled checks.
- Campaign uses the existing sequential per-logical-user submission model.
- Checks remain diagnostics rather than the only gate.
- Thresholds match the acceptance-gate model.
- Completion-failure thresholds are removed or no longer used as hard cron/campaign gates.
- Built-in k6 tags stay low-cardinality.
- High-cardinality job names, session IDs, pod names, and per-job identifiers do not become
  Prometheus tags.

### Surface Runtime Tests

Surface tests should cover:

- Direct Kubernetes reports success when Job creation succeeds and the Job becomes visible.
- Direct Kubernetes records completion latency when completion occurs.
- Direct Kubernetes does not fail solely because completion is delayed after acceptance.
- Kueue reports success when the Workload becomes visible.
- Kueue records admission evidence separately when admission occurs.
- Kueue does not fail solely because all Workloads are not admitted.
- Skaha reports success when session creation returns a visible or Pending state.
- Skaha records completion evidence separately when completion occurs.
- Cleanup metrics remain emitted.
- Expected work metrics remain emitted before acceptance outcomes are interpreted.
- Secret material does not appear in metric tags, logs, or evidence output.

### Helm Chart Tests

Helm chart tests should cover:

- The `cron` chart renders one CronJob per default surface.
- The `cron` chart renders a 5-minute schedule.
- The `cron` chart renders the expected workload duration and observation values.
- The `cron` chart renders separate surface configuration.
- The `campaign` chart renders per-surface `TestRun` resources.
- The `campaign` chart renders all surfaces by default.
- The `campaign` chart respects surface overrides.
- The `campaign` chart requires `totalJobs`.
- The `campaign` chart requires `logicalUsers`.
- The `campaign` chart rejects invalid safety-gate values.
- Both charts render the default image repository and Release Please-managed image tag.
- Both charts render required service accounts and RBAC.
- Both charts render restricted pod and container security contexts.
- Charts do not create or own the shared workload namespace.
- Charts can create or target the control namespace path.
- Charts mount Skaha credentials only as Secret-backed volumes.
- Charts keep OTLP credentials out of ConfigMaps.

### Dashboard Tests

Dashboard tests should cover:

- Variables include `runClass`.
- Variables include `campaignType`.
- Variables no longer assume old run-class values.
- PromQL expressions use the new runtime tag model.
- Dropped-iteration panels query valid k6 OTLP/Prometheus metric names.
- Data I/O panels query valid k6 OTLP/Prometheus metric names.
- Expected jobs are available as a top-row stat and in the diagnosis matrix.
- Target-state and cleanup percentage panels use expected jobs as the denominator.
- API server request-rate panels use deployed Kubernetes API metric label values.
- API server p95 latency panels use deployed Kubernetes API metric label values.
- No-data warning panels still work after the taxonomy change.

### CI Tests

CI validation should cover:

- Dependency installation with `bun ci`.
- Linting.
- Type checking.
- Unit tests.
- k6 bundle build.
- k6 dry run.
- Helm lint.
- Helm template rendering.
- Docker build validation.

### Prior Art

The current repo already has tests for configuration resolution, k6 options, metric contracts,
dashboard JSON, Kubernetes Job manifests, Skaha client behavior, Kueue behavior, direct Kubernetes
behavior, campaign reports, and run evidence. New tests should follow those patterns: assert the
public contract, keep fixtures small, and avoid snapshotting large rendered YAML unless the
snapshot captures an intentional operator-facing contract.

## Out of Scope

- Publishing Helm charts to an OCI registry.
- Publishing Helm chart archives to GitHub Releases.
- Creating a new Bun operator CLI.
- Creating a `bunx perfpulse` deployment interface.
- Installing the k6 Operator from PerfPulse charts.
- Installing Kueue from PerfPulse charts.
- Installing Prometheus or Grafana from PerfPulse charts.
- Creating or owning the shared workload namespace.
- Creating Skaha credentials inside Helm.
- Storing secrets in ConfigMaps.
- Digest pinning the runner image.
- Preserving Grafana history under old `spot`, `benchmark`, and `stress` run-class values.
- Keeping static rendered manifests as supported deployable artifacts.
- Keeping the kind proof-of-concept workflow as maintained CI.
- Requiring workload completion as a hard success gate.
- Defining formal SLOs or SLAs from PerfPulse measurements.
- Creating alerting policy for benchmark or stress campaigns.
- Creating sub-task issues in Jira as part of this PRD capture.

## Further Notes

During planning, a read-only check of the active cluster context found no active PerfPulse load job
running at that moment. Completed historical PerfPulse jobs were present, but no permanent
PerfPulse CronJob was installed. The observed 100-virtual-user behavior comes from current repo
defaults and generated manifests for benchmark and stress profiles, not from an active permanent
PerfPulse load generator.

The dashboard no-data issues are included in this PRD because the runtime taxonomy and dashboard
filter model are changing together. Fixing metric names and Kubernetes API-server query labels in
the same implementation avoids forcing operators through two dashboard migrations.

This PRD intentionally favors a small public interface over many named profiles. The long-term
operator language should be:

- Deploy cron checks.
- Run a benchmark campaign.
- Run a stress campaign.
- Choose surfaces when diagnosing.
- Set total jobs and logical users when sizing a campaign.

That is the cohesive model the implementation should preserve.
