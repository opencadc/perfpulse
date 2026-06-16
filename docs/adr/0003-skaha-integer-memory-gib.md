# Skaha session RAM must be a whole GiB integer

Skaha session create accepts a `ram` query parameter on
`POST /skaha/v1/session`. That value must be a **positive integer count of gibibytes**.
Fractional or unit-suffixed strings (for example `1.5`, `1Gi`, `512Mi`) are not valid Skaha
session inputs.

## Evidence

Staging Skaha exposes allowed memory through `GET /skaha/v1/context`:

- `memoryGB.options` is a list of whole integers (`1` … `36`).
- `memoryGB.default` is `4`.

When PerfPulse sends `ram=1`, Skaha Tomcat may log `Unknown memory unit: not` on session GET
polls, and the session JSON may report fractional `requestedRAM` (for example `1.07`). The HTTP
API still returns `success: true`. The **client must send an integer**; do not treat
`requestedRAM` in GET JSON as the authoritative request value.

Manual validation on **2026-06-16** (`cadcauthtest1`, public
`https://staging.canfar.net/skaha/v1/`):

| `ram` sent | POST | `requestedRAM` in GET | Session outcome (after image fix) |
|------------|------|------------------------|-----------------------------------|
| `1` | 200 | `1.07` | `Completed` (~73s for 60s workload) |

Earlier failures with `Failed` / init `exec format error` were caused by a single-arch workload
image, not by `ram=1`. See ADR-0004.

The workload image is built from `docker/stress-ng/Dockerfile` (Ubuntu + `stress-ng` only) and
published manually with local `docker build` / `docker push` to
`images.canfar.net/skaha/stress-ng:latest` (see README).

## Decision

PerfPulse **must** send integer **`ram=1`** and **`cores=1`** on Skaha session create, aligned
with ADR-0002 fixed footprint. Do not compute or format fractional gibibytes for the Skaha API.

Implementation: `encodeCreateSessionParams()` in `src/skaha.ts` uses
`String(Math.max(1, Math.trunc(params.ram ?? 1)))`.

## Considered options

- Encode Kubernetes-style quantities (`1Gi`) in the Skaha query string. Rejected; Skaha expects a
  bare integer GiB count, not a Kubernetes resource quantity string.
- Bump Skaha to `ram=2` because GET shows fractional `requestedRAM`. Rejected; ADR-0002 requires
  1 GiB and `ram=1` completes successfully with the fixed multi-arch image.

## Consequences

- Skaha session requests use integer gibibyte counts only (`ram=1` for v1).
- Direct and Kueue Kubernetes Job manifests remain on `1Gi` requests/limits (ADR-0002); Skaha
  RAM is a separate API field, not the same string as `resources.requests.memory`.
- Operators debugging Skaha should confirm `ram` in the create URL is an integer and cross-check
  `/context` `memoryGB.options` for allowed values on the target Skaha deployment.
