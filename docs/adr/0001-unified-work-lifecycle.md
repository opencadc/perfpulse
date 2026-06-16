# Unified work lifecycle module

PerfPulse measures the same per-job path on every **Test surface**: submit, observe visibility,
then optionally wait for terminal completion. The implementation duplicated that pipeline across
`kubernetes/direct.ts`, `kubernetes/kueue.ts`, and `skaha.ts`.

We will collapse those paths into one work-lifecycle module with small surface adapters. The
module owns timing, metrics, **Require completion**, **Opportunistic completion**, and
**Admission gate** policy. Adapters own protocol details only (Kubernetes Job create, Kueue
Workload visibility, Skaha session HTTP).

**Considered options:** keep three parallel `run*Surface` functions; or use a global
submit-all-then-poll campaign model. Rejected because overlap requires **Per-job lifecycle**
tracking from accept time, and triplication made policy changes easy to miss (for example
`requireCompletion` wired only on Skaha).

**Consequences:** `perfpulse.ts` becomes setup/default/teardown plus a surface registry.
Kueue admission hard-fails on **Cron check** only; benchmark and stress record admission
diagnostically. Stress iterations succeed after visibility unless completion is already
observed during that pass.
