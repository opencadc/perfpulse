# PerfPulse

PerfPulse is the performance evidence context for validating CANFAR workload paths under
routine checks, benchmark pressure, and rare stress campaigns.

## Language

**PerfPulse**:
An in-cluster k6-based product for generating and recording workload-path performance evidence.
_Avoid_: `kr`, Python benchmark tool, plot generator

**Thin horizontal slice**:
The smallest deployed evidence path from k6 `TestRun` through direct Kubernetes workload
completion, Prometheus remote write, Grafana queryability, and cleanup.
_Avoid_: horizontal runner scaling, distributed k6 execution

**Spot check**:
A small hard-gated run that proves a workload path is healthy enough for operational confidence.
_Avoid_: smoke test, synthetic monitor

**Routine benchmark**:
A repeatable bounded run that measures comparable performance over time without intentionally
finding the cluster limit.
_Avoid_: stress test, spot check

**Stress campaign**:
A rare large-scale run that characterizes cluster or control-plane capacity boundaries.
_Avoid_: routine benchmark, scheduled check

**Test surface**:
One workload submission path that PerfPulse can drive and measure.
_Avoid_: backend, provider

**Visibility gate**:
The configured time window in which accepted work must become observable through the target
surface's status model.
_Avoid_: completion SLO

**Completion gate**:
The configured time window in which a tiny spot workload must reach the target terminal state.
_Avoid_: visibility gate, benchmark SLO

**Logical user**:
A synthetic user bucket used by k6 to model submission shape.
_Avoid_: real Skaha user, service account

## Relationships

- A **Spot check**, **Routine benchmark**, or **Stress campaign** runs one or more **Test surfaces**.
- A **Thin horizontal slice** proves exactly one **Test surface** before broader profiles are enabled.
- A **Visibility gate** applies after submission succeeds and before completion is evaluated.
- A **Completion gate** is a hard spot-check gate for tiny direct Kubernetes and Skaha workloads.
- A **Logical user** can submit many workloads, but it is not necessarily a real authenticated user.

## Example Dialogue

> **Dev:** "Should the first PerfPulse run use Kueue and Skaha?"
> **Domain expert:** "No. First prove the thin horizontal slice with one completed direct Kubernetes Job, then add Kueue admission and Skaha completion as separate test surfaces."

## Flagged Ambiguities

- "Horizontal deployment" is resolved as **Thin horizontal slice**, not distributed k6 runner
  parallelism.
- "Spot check" is resolved as an operational hard gate, while **Routine benchmark** and
  **Stress campaign** are measurement activities with different failure semantics.
