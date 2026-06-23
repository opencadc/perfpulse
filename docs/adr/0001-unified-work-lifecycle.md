# Unified work lifecycle module

PerfPulse measures the same per-job path on every **Test surface**: submit, observe running
visibility, then optionally wait for terminal completion. The implementation duplicated that pipeline across
`kubernetes/direct.ts`, `kubernetes/kueue.ts`, and `skaha.ts`.

We will collapse those paths into one work-lifecycle module with small surface adapters. The
module owns timing, metrics, **Require completion**, **Opportunistic completion**, and
**Admission gate** policy. Adapters own protocol details only (Kubernetes Job create, Kueue
Workload lookup, Skaha session HTTP).

**Considered options:** keep three parallel `run*Surface` functions; or use a global
submit-all-then-poll campaign model. Rejected because overlap requires **Per-job lifecycle**
tracking from accept time, and triplication made policy changes easy to miss (for example
`requireCompletion` wired only on Skaha).

**Consequences:** `perfpulse.ts` becomes setup/default/teardown plus a surface registry.
Kueue admission is diagnostic; the target state is the created Job becoming running or terminal
successful. Cron and benchmark iterations succeed after running visibility unless completion is
explicitly required.
