# perfpulse

perfpulse measures the CANFAR Science Platform from the outside: it starts sessions, copies files and
times listings the way a user would, and pushes the numbers to the shared Prometheus for the
CANFAR dashboards in opencadc/science-platform.

## Language

**Probe**:
A `@perfpulse` function with no parameters that reads the environment and returns `str` keys to
numbers. Its name is the metric name prefix.
_Avoid_: test, scenario, check

**Run**:
One execution of one probe in one process: run once, push once, exit. A run either reports every
value it returned or none (`perfpulse_probe_success` 0).
_Avoid_: iteration, campaign

**Probe key**:
The chart's name for one scheduled use of a probe (`spawn-notebook`, `spawn-headless` both run
`spawn_session`). It becomes the `instance` label and names the probe's session or directory.

**Installation**:
One CANFAR deployment: canfar staging, canfar prod, SRC staging, SRC prod. Its id is the Skaha
release name (`canfar-skaha-prod`). It becomes `service.namespace`, so every series sits under
`job="<installation>/perfpulse"`.
_Avoid_: environment, cluster (all four share the keel-prod cluster)

**Workload probe**:
A probe that runs in the installation's session namespace through Kueue with /arc mounted, so it
sees storage the way a session does.

**Node probe**:
A probe run on N nodes at once, one pod per node, each series labelled `node`.

## Invariants

- One writer per series: one CronJob per probe key with `concurrencyPolicy: Forbid`. Out-of-order
  samples cannot happen, so there is no overlap gate.
- Labels never come from a probe's return value. Cardinality is fixed by the chart.
- A probe that launches something deletes it in `finally` and sweeps leftovers by its fixed name
  before it starts.
