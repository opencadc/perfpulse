# Skaha session probe contract

The session probe (`perfpulse.probes.skaha:spawn_session`) must speak Skaha's HTTP API exactly as
below. Learned on staging in 2026-06 and kept through the Python rewrite.

## Contract

- **Create:** `POST {SKAHA_URL}/session?name=&image=&type=&cores=1&ram=1[&cmd=&args=]` with an
  **empty body** and these headers:
  - `Authorization: Bearer <token>`;
  - `X-Skaha-Authentication-Type: RUNTIME-TOKEN`;
  - `Content-Type: application/x-www-form-urlencoded`.

  `ram` and `cores` are integers.
- **Create response:** a plain-text session id, not JSON.
- **Poll:** `GET /session/{id}` returns JSON whose `status` moves from `Pending` to `Running`,
  then `Completed` or similar. A notebook's `connectURL` carries its token. The session is ready
  when that URL answers HTTP 200.
- **List:** `GET /session` returns the caller's sessions, with `name`.
- **Delete:** `DELETE /session/{id}` always answers success; Skaha swallows errors.
- **Names** match `[A-Za-z0-9-]+` and are lowercased.
- **Images:**
  - A public image needs no registry credential. A private one would need
    `X-Skaha-Registry-Auth`, which the probe does not send.
  - Cluster nodes are linux/amd64, so images must publish amd64.

## Decision

- **Name and cleanup:** each probe key names its session `perfpulse-<probe key>`. Before
  creating, the probe deletes any session of its user with that name, and it deletes its own
  session in `finally`. A run killed before cleanup therefore leaks at most one session, which
  the next run sweeps and counts in `swept_sessions`. This matters because Skaha allows a user
  3 sessions, headless included.
- **Timeouts:** HTTP calls may take up to `SKAHA_HTTP_TIMEOUT_SECONDS` (default 600), because a
  slow submit is a measurement. The probe deadline bounds the whole run.
