# Fixed 1 CPU / 1 GiB / 60s workload

PerfPulse workloads are intentionally tiny control-plane and path exercises, not resource
or runtime stress tests. Every submitted job uses a fixed footprint of **1 CPU** and **1 GiB RAM**
and a fixed **60 second** `stress-ng` runtime on all **Test surfaces**, including direct
Kubernetes, Kueue, and Skaha.

Skaha already enforces `cores=1` and `ram=1` as API minimums. Direct Kubernetes Jobs previously
used smaller CPU requests (`100m`) and variable durations via `job_profile`. We align all surfaces
to the same footprint and runtime so surface comparisons measure path behavior, not workload-shape
differences.

Workload image remains configurable; CPU, memory, and runtime duration are not operator-tunable
in v1.

**Considered options:** keep smaller direct Kubernetes requests for denser scheduling; keep
`job_profile` duration variants (`tiny`, `small`, `standard`, `heavy`); expose `WORKLOAD_*`
overrides. Rejected to reduce configuration surface and keep campaign semantics focused on
submission, queueing, visibility, and cleanup at scale.

**Consequences:** Kubernetes Job manifests use `1` CPU / `1Gi` requests and limits with a 60s
`stress-ng` timeout. Remove `job_profile` from runtime config, metric tags, and dashboards.
Remove Helm `workload.durationSeconds` tuning in favor of the fixed value.
