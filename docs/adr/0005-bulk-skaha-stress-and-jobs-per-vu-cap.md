# Superseded: bulk Skaha stress lifecycle and jobs-per-VU cap

Status: Superseded by ADR-0006.

This ADR originally introduced a Skaha-only bulk stress lifecycle and a public benchmark/stress
campaign split. That design is no longer the active architecture. PerfPulse now has only two run
classes, `cron` and `benchmark`, and every surface uses the same per-job lifecycle:

1. submit the workload,
2. prove it is running-visible on the target surface,
3. delete it,
4. record terminal completion only when completion was explicitly required or already observed.

The retained part of this ADR is **Jobs per VU cap**. `jobsPerVuCap` still rejects benchmark
runs where `logicalUsers < ceil(totalJobs / jobsPerVuCap)`, so large campaigns must choose enough
logical users instead of silently overloading a single VU.

The removed parts are:

- Skaha-only bulk submit/poll/delete batches.
- `campaignType=benchmark|stress`.
- `CONFIRM_STRESS`.
- Skaha bulk poll environment knobs.
- Target-state success based on mere Skaha `Pending` visibility.
