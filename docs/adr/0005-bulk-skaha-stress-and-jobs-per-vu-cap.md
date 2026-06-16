# Bulk Skaha stress lifecycle and jobs-per-VU cap

Stress campaigns need to model a logical user submitting hundreds or thousands of Skaha sessions
without one k6 iteration per session. Operators also need a controllable limit on how many workloads
each VU owns so direct, Kueue, and Skaha campaigns scale VU count with job count.

## Learnings (from staging validation)

See ADR-0004 for Skaha HTTP contract, `stress-ng` args, registry auth, and image requirements.
Bulk stress builds on that contract: consecutive session POSTs, session-id poll list, inline DELETE.

## Decision

### Jobs per VU cap (all campaign surfaces)

- Introduce `jobsPerVuCap` (env `JOBS_PER_VU_CAP`, default **500**).
- Reject config when `logicalUsers < ceil(totalJobs / jobsPerVuCap)` with a message to raise
  `LOGICAL_USERS` or `JOBS_PER_VU_CAP`.
- Applies to **Routine benchmark** and **Stress campaign** on all **Test surfaces**.
- Remove `CONFIRM_SEQUENTIAL` and `SEQUENTIAL_CAMPAIGN_THRESHOLD` entirely.

### Bulk Skaha stress lifecycle (Skaha stress only)

- k6 options: `iterations = logicalUsers`, `vus = logicalUsers` (not `iterations = totalJobs`).
- Each VU in one iteration:
  1. **Submit phase** — consecutive `POST /session?…` for `jobsPerLogicalUser` sessions.
  2. **Poll phase** — round-robin `GET /session/{id}` with **1s** global tick and **≥15s** minimum
     between GETs for the same session id (`SKAHA_BULK_POLL_MIN_SECONDS`, default 15).
  3. **Cleanup** — `DELETE /session/{id}` immediately when a session reaches a terminal state.
  4. **Exit** — iteration ends when every session is terminal or the **Completion gate** expires.
- Terminal `Failed` / `Error` sessions record failure metrics but do not abort the batch.
- Direct and Kueue stress keep **Per-job lifecycle** with `iterations = totalJobs`; only the
  **Jobs per VU cap** validation applies.

### Metrics

- Per-session: submitted, visible (first `Pending`/`Running` on poll), completed (terminal),
  completion latency from accept time, cleanup success/failure.
- Batch stragglers past **Completion gate** fail the VU iteration.

## Considered options

- Keep `CONFIRM_SEQUENTIAL` alongside the cap. Rejected; cap + `CONFIRM_STRESS` is sufficient.
- Auto-raise `logicalUsers` when under minimum. Rejected; explicit operator VU count.
- Apply bulk lifecycle to direct/Kueue stress. Rejected for v1; different visibility models.

## Consequences

- New Skaha bulk runner module (or surface adapter) separate from `runWorkLifecycle` per-job path.
- `options.ts` branches on `surface === "skaha" && campaignType === "stress"`.
- Helm campaign chart exposes `JOBS_PER_VU_CAP`; remove `CONFIRM_SEQUENTIAL` from docs and values.
- ADR-0001 per-job lifecycle remains default; this ADR documents the Skaha stress exception.
