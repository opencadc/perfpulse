# Observability work package

Covers the 12 open observability tickets under epic CADC-15560 (Job Monitoring). Two threads:
rebuild perfpulse as a Python OTel probe runner, and one Grafana dashboard set for all four
CANFAR installations with findable key indicators. Implementation: [`src/perfpulse/__init__.py`](../../src/perfpulse/__init__.py).

## Problem

- **One backend, four installations.** canfar staging, canfar prod, SRC staging and SRC prod
  all run on keel-prod and share one Prometheus, one Mimir and one Grafana. `cluster` is
  `keel-prod` everywhere, so it separates nothing.
  - Namespaces do separate them.
  - OTLP services report the same `job` in every installation (`skaha-metrics`,
    `skaha-controller`), so their series merge.
  - Dashboards pin `$namespace` to one namespace at render time, so SRC sessions never appear.
  - SRC prod's Metrics reports canfar prod's namespace (a typed-value bug).
- **The backend is admin-owned.** No PrometheusRule, no relabeling, no
  `promote_resource_attributes`. The Mimir Ruler accepts rules over HTTP. Capsule forbids
  cluster-scoped RBAC.
- **OTLP push semantics.** The receiver rejects out-of-order samples, has no staleness
  markers, and turns only `service.*` resource attributes into labels.
- **perfpulse today** is 3.8k lines of TypeScript on k6, installed by hand.
  - Its hardest parts exist to work around those push semantics: the cron gate, a service
    name per run, layered timeouts.
  - It probes only staging Skaha.
  - Must survive the rewrite: the Skaha HTTP contract (ADR-0004) and "a launched session is
    always deleted".
- **The dashboards** are 11 dashboards, 195 panels, no landing page, many duplicates, and
  wrong storage totals.

## Usage (caller's view)

**Probe author** (perfpulse repo, or an image `FROM perfpulse`):

```python
from perfpulse import perfpulse

@perfpulse
def download_data_from_vault() -> dict[str, float]:
    url = os.environ["VAULT_URL"]                 # inputs: environment only
    ...
    return {"bytes": size, "seconds": elapsed}    # str -> number, nothing else

@perfpulse
def spawn_session() -> dict[str, float]:          # replaces the whole k6 lifecycle
    with session(os.environ["SESSION_TYPE"]) as s:  # sweeps this probe's leftover session by name, deletes in finally
        return {"create_seconds": s.create_seconds, "ready_seconds": s.ready()}  # notebook: URL answers
```

`session()` lives in `perfpulse.probes.skaha`: a CANFAR probe helper, not public API.

**Operator** (keel-deploy, one perfpulse release per installation, installed in that
installation's system namespace):

```yaml
installation: canfar-skaha-prod       # required; service.namespace -> job="canfar-skaha-prod/perfpulse"
workload: {namespace: canfar-workloads, queue: cadc-default, arcClaim: canfar-workloads-production-pvc}
probes:
  spawn-notebook: {function: perfpulse.probes.skaha:spawn_session, schedule: "*/10 * * * *", timeout: 900,
                   env: {SESSION_TYPE: notebook}}
  arc-copy:       {function: perfpulse.probes.arc:arc_scratch_copy, schedule: "17 * * * *", workload: true}
  disk-bench:     {function: perfpulse.probes.node:disk_benchmark, schedule: "0 3 * * *", workload: true, nodes: 12}
```

**What lands in Prometheus:**

```
spawn_session_ready_seconds{job="canfar-skaha-prod/perfpulse", instance="spawn-notebook"}   41.7
perfpulse_probe_success{…} 1     perfpulse_probe_duration_seconds{…} 44.2
```

**Dashboard reader.** Opens *CANFAR · Home* and sees one row of 12 indicators per
installation. Every link keeps the chosen installation.

**Dashboard author.** Scopes each selector one of three ways:
`namespace=~"$namespace"` / `"$system_namespace"`, `job=~"${installation:regex}/<service>"`,
or `installation=~"$installation"`. The lint rejects anything else.

## Shape

### perfpulse: one module, one process model

- **Run model.** One process is one run of one probe and one OTLP export. The chart renders
  one CronJob per probe (`Forbid`, `backoffLimit: 0`, deadline = timeout + 90 s,
  `terminationGracePeriodSeconds` above grace + OTLP timeout).
  - Flow: import `module:function` → `_supervise` (forked child) → `_validate` → `_series` →
    `_push` → exit 0/1/2.
- **Naming.** Key `k` of function `f` becomes the gauge `f_k`.
  - Keys are name suffixes, never a label, so one name carries one unit and `sum`/`avg`
    keep their meaning.
  - Keys end in a base unit (`seconds`, `bytes`, `ratio`) or a plural noun.
  - Type suffixes (`_total`, `_count`, `_bucket`, …) and non-base units (`_ms`, `_gib`,
    `_percent`) are rejected.
  - Every instrument is a unitless gauge named `[a-z0-9_]`. Verified in Prometheus
    3.0–3.16 source: every translation strategy stores the name unchanged.
  - CI fails when one probe name is a `_`-prefix of another, so no two probes can produce
    the same metric name.
- **Emitted automatically.** `perfpulse_probe_success` (1/0) and
  `perfpulse_probe_duration_seconds`, the same pair the blackbox exporter uses.
  - Freshness comes from `kube_cronjob_status_last_successful_time`, which is independent
    of OTLP.
- **Failure.** All or nothing. Raise, timeout, crash and a bad return all produce
  `success 0` plus the duration, and no values.
  - The deadline is a `BaseException` raised in the child, so `finally` gets 20 s of grace.
  - An OOM kill takes the whole container on cgroup v2; the failed Job reports that case.
  - A rejected push exits 2. Non-zero fails the Job.
  - One deadline per probe settles the 30 s vs 10 min question: a slow submit is a measurement.
- **Push semantics.** The resource is exactly `service.namespace=<installation>`,
  `service.name=perfpulse`, `service.instance.id=<probe key>`. Node probes add only a
  `node` point attribute.
  - With only identifying attributes, Prometheus writes no `target_info` (verified in source).
  - One writer per series plus `Forbid` means out-of-order is impossible. An identical retry
    is accepted. The cron gate is deleted.
  - Staleness is a lint rule: probe series are read through `*_over_time`.
- **Placement.**
  - API probes run in the installation's system namespace and hit the public Skaha URL, as
    a user does.
  - `workload: true` probes run in the session namespace:
    - with the Kueue queue label (`cadc-default` or `src-default`). Unlabelled Jobs bypass
      Kueue there, because `manageJobsWithoutQueueName` is false;
    - with restricted PSA, the session node pool, and the /arc claim mounted with
      `subPath: cavern`.

    So /arc and node probes do not depend on Skaha launching anything.
  - `nodes: N` gives N pods under required hostname anti-affinity.
- **Where probes live.** CANFAR's live in `perfpulse.probes.*` in the image. Others build
  `FROM perfpulse` with modules on `PYTHONPATH`. The chart always names `module:function`,
  and `main` refuses a function that isn't decorated.
- **Cleanup.** A session probe uses a fixed session name per probe key and deletes any
  session carrying it before creating one. A killed run leaks at most one session until the
  next run, which matters because Skaha allows a user 3 sessions, headless included.

### Installation identity: one map, carried three ways

- **The one list.** `grafanaDashboards.installations` in keel-deploy (on `canfar-skaha-prod`,
  the release that ships the dashboards). Key = installation id = Skaha release name; value
  = `{system: <release ns>, workloads: <session ns>}`.
  - The chart renders it into a Mimir rule group, `canfar_installation_info{installation, role, namespace} 1`.
  - A PostSync Job runs `mimirtool rules sync --id=anonymous --namespaces=canfar`, which
    touches only that rule namespace.
  - The render fails if two installations claim one namespace.
- **Scraped series** (KSM, cAdvisor, kubelet, Kueue LocalQueue): Grafana derives hidden
  `$namespace` and `$system_namespace` from `$installation` through that series. The
  existing 375 `namespace=~"$namespace"` matchers keep working.
- **OTLP series.** The Skaha chart gets an `installation` helper (default `.Release.Name`).
  It injects `OTEL_RESOURCE_ATTRIBUTES=service.namespace=<id>` in the Tomcat telemetry
  block and in Metrics, so `job` becomes `<id>/skaha-controller` and `<id>/skaha-metrics`.
  - It defaults `METRICS_OTEL__SERVICE_NAME` to `skaha-metrics` and derives
    `METRICS_OTEL__KUBERNETES_NAMESPACE` from `.Release.Namespace`.
  - It fails the render if `metrics.env` or `extraEnv` still sets any of these three. That
    deletes the typed values in keel-deploy and the SRC prod bug.
  - perfpulse sets the same id from its required `installation` value.
- **Rollups.** The rules join on the info series and stamp `installation`.
- **Guard.** A Health coverage table lists:
  - map entries missing Skaha, Metrics or perfpulse series;
  - `*/skaha-metrics` jobs, and session pods, in namespaces the map lacks.

  A wrong copy shows there, or as a failing probe, never as wrong numbers.
- **Cluster-wide series** (nodes, `node_vmstat_oom_kill`, ClusterQueues `cadc`/`src`, which
  staging and prod share) appear only on the shared *Cluster* dashboard.

### Measured, derived, rolled up

| Requirement (science-team list, CADC-14627 table) | Source |
|---|---|
| Interactive session fails to start; launch time | probes `spawn-notebook`, `spawn-headless` |
| /arc ↔ scratch copy, 100 × 1 KB and 1 × 1 GB, both ways | probe `arc_scratch_copy` (workload) |
| WebUI/vls listing of /home and /projects | probe `vospace_listing` (storage API, permissions included) |
| Files and bytes on /arc; correct "used"; CADC vs luskan | probes `arc_usage` (CephFS `ceph.dir.rbytes`/`rfiles`), `cadc_storage` |
| Node CPU, GPU, disk performance | probes `cpu_benchmark`, `disk_benchmark`, later `gpu_benchmark` (`nodes: N`) |
| Why headless jobs die (OOM, eviction, deadline) | PromQL: `kube_pod_container_status_terminated_reason` by kind (not `last_terminated_reason`, which needs a restart) |
| Pending time vs requested resources | rule `canfar:session:queue_wait_seconds` cut by requested cores |
| Memory/CPU used vs requested, idle sessions, by kind/user | rules `canfar:session:*`, `canfar:kind:*`, `canfar:user:*` |
| Session Usage Summary Statistics | hourly rules, per-pod max over a trailing day, P10–P90 per kind |
| Stranded cores, jobs per node, GPUs allocated | PromQL on KSM (already on Capacity) |
| Scratch used per session, GPU memory, per-pod /arc I/O | not tenant-observable: needs ops-run ephemeral-storage and DCGM exporters |

### Dashboards: 11 become 7

| Dashboard | Scope | Built from |
|---|---|---|
| **Home** (new, org home) | installation | 12 stats per installation: sessions start %, time to ready, 1 GB from /arc, 100 small files, list /home, storage used, running, queued, longest wait, CPU used/requested, memory used/requested, API 5xx. Then trends (by kind) and a "where next" signpost. Every repeated-row query uses only `$installation` (checked). |
| Sessions | installation | sessions + overview + communities + efficiency; new "held by kind" row (cores and memory requested, limit and used) |
| Usage | installation | usage, reading `canfar:*` rollups; summary-statistics table; interactive vs headless |
| Drilldown | installation | drilldown; SRC sessions and logs now selectable |
| Health | installation | platform-health + LocalQueue backlog + PVC storage + probe table + terminations + queue wait + requested scratch and evictions + coverage |
| Services | installation | services; untagged `shared`; `$skaha_job`, `$metrics_job`, `$service_namespace` and 17 literal namespaces replaced |
| Cluster | shared | capacity + ClusterQueues + node OOM + node disks + node probes (nodes reporting vs nodes in pool) |

Each dashboard opens with stats answering its one question and links to Home.

**Migration cost, measured on the current JSON.** Of 688 selectors, 375 already carry
`namespace=~"$namespace"`. Beyond swapping the variable block, these edits are needed:
- 113 join partners (mostly `kube_pod_status_phase{phase="Running"}`) gain the matcher;
- 7 `$namespace` definitions are replaced;
- about 15 cluster-wide panels move off scoped dashboards (`kube_node_*`,
  `node_vmstat_oom_kill`, `kueue_pending_workloads`);
- 5 Drilldown links pass `var-installation`;
- `test_dashboard_contract.py` matches `/skaha-metrics` instead of `$metrics_job`.

A prototype migrated Drilldown and Services, and the lint passes on both.

**Deleted:**
- about 15 duplicate panels;
- the storage totals, which add one CephFS's statfs once per claim and give 43.9 PiB
  against 1.93 PiB of projects;
- the `__CANFAR_*_NS__` placeholders, five variables, and seven uids.

**The lint** fails on:
- uid collisions;
- a selector scoped none of the three ways;
- a probe series read without a range function;
- a dashboard that is both installation-scoped and shared.

**Deleted from perfpulse:**
- all TypeScript, k6, bun and biome;
- both charts, the cron gate and its RBAC;
- the direct-Kubernetes and Kueue surfaces, campaigns, run-id labels, `jobs_expected`,
  `response_body`;
- its dashboard and ADRs 0001–0003, 0005 and 0006.

ADR-0004's Skaha contract moves into `perfpulse/probes/skaha.py`. Create requests send
`Content-Type: application/x-www-form-urlencoded`, and the session id comes back as plain
text.

## Synthesis decision

**How it ran.** Arena with three runners:
1. Fable max, free stance.
2. Opus max, free stance.
3. Opus max, pinned to run-once probes and identity via Mimir recorded series.

The cross-judge was Fable max. It is the same model family as the parent, which is what the
configured pool offered. Scores out of 30: C1 27, C2 21, C3 22.

**Base: C1.** I leaned C2 before the judge reported. Two of the judge's findings held up
against the code:
- C2's scraped-series scoping rests on a `kube_namespace_labels` allowlist that nobody has
  verified for namespaces.
- C2's per-node pods share one `target_info` writer, because `Resource.create` adds SDK
  attributes.

**Grafts:**
- **From C2:** the Skaha chart derives the id from its release name; a probe key separate
  from its function (notebook plus headless from one probe); `workload: true` placement for
  /arc probes.
- **From C3:** map guards; reserved-suffix rejection; freshness from KSM CronJob status;
  the notebook URL check; the `Content-Type` header.

**Rejected:**
- C3's "every panel reads a recorded series" and its TypedDict returns.
- C2's age-based session sweep.
- The `perfpulse_` name prefix: the owner's rule is "function name = metric name".

**Convergence.** All three runners independently chose run-once CronJob probes, unitless
`<fn>_<key>` gauges, success plus duration, and an export checked through
`exporter.export()`.

**Verification by a 4-worker swarm:**
1. A prototype of the sketch passed 65 tests. It also found 8 defects, now fixed in the
   sketch: forced fork, closing the pipe, signal forwarding, OOM wording, grace budget,
   entry point, name collisions, and the registry dropped.
2. Prometheus 3.0–3.16 and kube-state-metrics 2.20 source confirmed the label, naming,
   `target_info` and out-of-order claims. It corrected the terminated-reason metric.
3. A dashboard prototype confirmed the lint, two migrations, the Home row and the map
   render with its duplicate check. It corrected the matcher counts.
4. A review against the repos found no blockers. It found 9 fixes, folded in here: the
   chart prerequisite, env clashes, the service name, the copy list, LocalQueue names,
   probe namespace, the 30-day quantile, retention, and the "closes" claims.

## Tradeoffs accepted

- We accept one sample per run, read through range functions. In exchange, there is no
  long-running process, and Kubernetes owns schedule, deadline, placement and run history.
- We accept no labels from a probe, and that an exception discards values already measured.
  In exchange, cardinality is fixed and there is one failure rule.
- We accept these hand-kept copies:
  - the installation id in each perfpulse release;
  - the map's namespaces, which repeat the Argo destination and `sessions.namespace.name`;
  - perfpulse's workload placement: session namespace, LocalQueue, /arc claim (it differs
    per installation, and SRC mounts `/cavern`), node pool and uid.

  In exchange, there are no cross-release lookups. Every wrong copy fails loudly, as an
  empty coverage row or a failing probe.
- We accept that dashboards ship from the canfar prod Skaha chart: every edit needs a chart
  release, and staging cannot preview them under the same uids. In exchange, there is no
  new chart or release pipeline. If that cadence hurts, move dashboards and rules to their
  own small chart.
- We accept that scoped panels go empty for time ranges before the info rule existed.
- We accept a hand-set `nodes: N`. In exchange, there is no DaemonSet and no node listing.
  Cluster shows nodes reporting against nodes in the pool.
- We accept a one-time break in OTLP history (`job` changes), and losing load campaigns and
  the direct and Kueue probes. In exchange, the codebase is one small Python module and a
  one-template chart.

## Alternatives considered

- **Daemon** (one Deployment scheduling probes, a DaemonSet for nodes).
  - Wins: continuous series and real counters.
  - Loses: it re-implements CronJob, one hung probe stalls all, a second replica brings back
    two writers, and a DaemonSet cannot hold a clean core or a GPU.
- **Identity from namespace labels** (C2). There is no hand list, but every scraped matcher
  depends on an admin-owned KSM allowlist that is unverified for namespaces.
- **Identity only in recorded series** (C3). This is the purest single map, but every panel
  and every new metric needs a rule first.
- **`service.namespace` = the release namespace.** Nothing is typed outside the map, but
  Home's repeated rows cannot follow a derived variable, so every Home query needs a
  `label_replace` join.
- **Push to Mimir's OTLP endpoint.** The gateway supports it, along with a per-tenant
  out-of-order window. The run-once shape doesn't need either, and the owner asked for
  Prometheus.

## Open questions and risks

- How does an unattended probe authenticate to SRC Skaha (SKA IAM, no password login)? Until
  this is answered, SRC runs only workload and storage probes.
- Can pods in session namespaces reach `prometheus-operated.monitoring:9090`? Can the
  PostSync Job reach the Mimir gateway? What is the tenant retention? Deliverable 7 needs at
  least 30 days.
- Which /arc directory and non-root uid may `arc_scratch_copy` write to? Is roughly 24 GiB a
  day of write-and-delete churn acceptable next to "reduce unnecessary I/O to /arc"?
- Will ops run an ephemeral-storage exporter and DCGM? Without them, scratch use per session
  (CADC-15017) and GPU memory stay unmeasured.
- Which luskan query and credential give the archive side of CADC-14463?
- Is kube-state-metrics scraped once? With two HA instances, every `sum by (namespace, pod)`
  in the rules doubles.

## Prerequisite

Deliverable 1 needs a Skaha chart release that renders keel-deploy's current canfar values.
Those values already use `communities`, which only the unmerged community-routing branch
supports. Land community routing first, or ship deliverable 1 on a chart cut from that
branch.

## Next implementation step

Add `grafanaDashboards.installations`, the `installation` helper and the `mimirtool` PostSync
Job to the Skaha chart, then swap the variable block in `drilldown.json`. That alone gives
SRC a working Session Drilldown.

## Work package

| # | Deliverable | Verify | Size | Repos | Jira |
|---|---|---|---|---|---|
| 1 | **Installation identity.** Map → `canfar_installation_info`; chart `installation` helper → `service.namespace`, derived Metrics namespace and service name, render fails on leftover typed values; SRC Skaha telemetry on; `$installation` + derived namespace vars in all dashboards; dashboards enabled on `canfar-skaha-prod`; lint. | `count by (installation)(canfar_installation_info)` = 4; `count by (job)({"canfar.metrics.readiness"})` shows 4 `<id>/skaha-metrics`; Drilldown with `var-installation=src-skaha-prod` lists SRC sessions; lint green | M | science-platform, keel-deploy | closes 16303; advances 16052 |
| 2 | **perfpulse core.** Implement the sketch test-first; delete the TypeScript. | `uv run pytest` green; one push, then `/api/v1/label/__name__/values` lists the gauge and no `target_info{job=~".+/perfpulse"}` exists | M | perfpulse | advances 16307, 14627 |
| 3 | **Image, chart, launch and listing probes on 4 installations.** `spawn-notebook`, `spawn-headless`, `vospace-listing`; 4 Argo apps; uninstall hand-installed k6 cron. | `helm template` golden test; `count_over_time(perfpulse_probe_success{job="canfar-skaha-prod/perfpulse"}[1h])` = 6 per 10-min probe; kill a run mid-launch, next run leaves no probe session in `GET /session` | M | perfpulse, keel-deploy | advances 16307, 14627 |
| 4 | **Rollup rules, kind split, rollup runbook.** `canfar:session|kind|user:*` (idle counts only live sessions); cores/memory requested, limit, used by kind; one-page runbook (OTLP push, no Alloy; rules via mimirtool, not PrometheusRule; retention is a tenant setting; Ruler auth). | `sum by (kind)(canfar:kind:cpu_requested_cores{installation="canfar-skaha-prod"})` matches the raw join within 1 %; a second person adds a rule from the runbook alone | M | science-platform | closes 16123, 16052 |
| 5 | **Home and consolidation 11 → 7.** Includes terminations, queue wait by request size, requested scratch and evictions on Health. | Lint green; 7 files; screenshot of Home with 4 filled rows; a click path from Home to every surviving old panel | L | science-platform | advances 16303, 16307, 12746, 15017 |
| 6 | **Storage probes and Storage fix.** `arc_scratch_copy`, `arc_usage`, `cadc_storage`; storage row on Health; wrong totals gone; days-to-full forecast. | `arc_usage_projects_bytes` within 5 % of the storage UI's project total; no PiB/GiB pair on screen; gap vs luskan matches John's manual figure | M | perfpulse, science-platform | closes 16346, 14463 |
| 7 | **Usage from rollups.** Daily summary statistics per session type (P10–P90 of per-pod max); interactive vs headless; idle definition; usage-pattern note after 4 weeks. Needs ≥ 30 d retention. | The table shows P10–P90 per kind per day for the last 30 days in < 5 s; Toby Brown approves (CADC-14627 AC); note reviewed with the science team | M | science-platform | closes 14627, 12746 |
| 8 | **Node probes and HEPScore spike.** `cpu_benchmark`, `disk_benchmark` with `nodes:`; node table on Cluster; half-day HEPScore23 spike under restricted PSA. | Nodes reporting = nodes in pool over 1 d; spike note on CADC-12879 (score or named blocker) | M | perfpulse, science-platform | advances 13397, 12879 |

Order: prerequisite, then 1. Then 2–3 (perfpulse) and 4–5 (dashboards) can run in parallel.
6–8 follow.

## Ticket coverage

| Ticket | Deliverables |
|---|---|
| CADC-16303 SRC workloads/users in Grafana | 1 (closes), 5 |
| CADC-16123 plots split by session kind | 4 (closes) |
| CADC-16346 Storage dashboard issues | 6 (closes) |
| CADC-12746 platform usage patterns | 4, 5, 7 (closes after 4 weeks of rollups) |
| CADC-16307 external observability metrics | 2–6. Closes on an agreed descope: GPU memory, scratch fraction and per-pod /arc bandwidth need ops exporters |
| CADC-14627 externally generated metrics | 2, 3, 7 (closes on Toby Brown's approval) |
| CADC-13397 node performance | 8 advances (CPU, disk). Closes with `gpu_benchmark`, or on an agreed CPU/disk scope |
| CADC-12879 container benchmarking | 8 spike only. Out of scope to build: no SRCNet commitment, and HEPScore likely needs privileges keel-prod forbids |
| CADC-14463 CADC space usage | 6 (closes once the luskan input is confirmed) |
| CADC-15017 scratch space changes | 5 advances (requested scratch and evictions). Use per session needs an ops exporter; the cap decision stays with CSD-4437 |
| CADC-16052 metrics rollup strategy | 1, 4 (closes) |
| CADC-13861 user observability with RCS FaaS | Out of scope: no SP-5030 requirements yet. `canfar:user:*` rollups are the hand-off surface when they arrive |
| CADC-16305 Metrics `/user` endpoint | Out of scope: science-portal user metrics (CADC-16100), not observability |
| CADC-16386 auth on `/metrics` | Out of scope: same epic, design undecided |
