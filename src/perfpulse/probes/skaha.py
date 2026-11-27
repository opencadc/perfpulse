"""Can a user start a session, and how long does it take?

Skaha contract (docs/adr/0004-skaha-workload-integration.md): create is ``POST /session`` with
query parameters, an empty form body and a bearer token, and answers a plain-text id; poll is
``GET /session/{id}``; delete is ``DELETE /session/{id}``.

Inputs (environment):
    SKAHA_URL: Skaha API base, e.g. ``https://ws-uv.canfar.net/skaha/v1``.
    CANFAR_TOKEN: Bearer token of the probe account.
    SESSION_IMAGE: Public image to launch (no registry credential is sent).
    SESSION_TYPE: ``headless`` (default) or ``notebook``.
    SESSION_CMD, SESSION_ARGS: Headless command; default ``sleep 600``.
    SKAHA_HTTP_TIMEOUT_SECONDS: Per-request timeout; default 600 (a slow submit is a measurement).
    PERFPULSE_PROBE: Set by the chart; names the session, so a leftover is found by name.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

from perfpulse import perfpulse

_POLL_SECONDS = 5.0
_RUNNING = frozenset({"Running", "Completed", "Succeeded"})
_FAILED = frozenset({"Failed", "Error", "Terminating"})


class SessionFailed(RuntimeError):
    """Skaha rejected the session, or it failed or disappeared before it was ready."""


class _Skaha:
    def __init__(self) -> None:
        self.url = os.environ["SKAHA_URL"].rstrip("/")
        self.timeout = float(os.environ.get("SKAHA_HTTP_TIMEOUT_SECONDS", "600"))
        self.headers = {
            "Authorization": f"Bearer {os.environ['CANFAR_TOKEN']}",
            "X-Skaha-Authentication-Type": "RUNTIME-TOKEN",
        }

    def _call(self, method: str, path: str, query: dict[str, str] | None = None) -> str:
        url = f"{self.url}{path}"
        if query:
            url = f"{url}?{urllib.parse.urlencode(query)}"
        headers = dict(self.headers)
        data = None
        if method == "POST":
            headers["Content-Type"] = "application/x-www-form-urlencoded"
            data = b""
        request = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return response.read().decode()
        except urllib.error.HTTPError as error:
            body = error.read().decode(errors="replace")[:512]
            raise SessionFailed(f"{method} {path}: HTTP {error.code}: {body}") from None

    def sweep(self, name: str) -> int:
        """Delete every session of this user named ``name``; return how many there were."""
        leftovers = [
            s["id"] for s in json.loads(self._call("GET", "/session")) if s.get("name") == name
        ]
        for session_id in leftovers:
            self._call("DELETE", f"/session/{session_id}")
        return len(leftovers)

    def create(self, name: str, kind: str, image: str) -> str:
        query = {"name": name, "image": image, "type": kind, "cores": "1", "ram": "1"}
        if kind == "headless":
            query["cmd"] = os.environ.get("SESSION_CMD", "sleep")
            query["args"] = os.environ.get("SESSION_ARGS", "600")
        return self._call("POST", "/session", query).strip()

    def wait_running(self, session_id: str) -> str:
        """Poll until the session runs; return its connect URL. The probe deadline bounds it."""
        while True:
            try:
                session = json.loads(self._call("GET", f"/session/{session_id}"))
            except SessionFailed as error:
                if "HTTP 404" in str(error):
                    raise SessionFailed(f"session {session_id} disappeared") from None
                raise
            status = session.get("status", "")
            if status in _RUNNING:
                return session.get("connectURL", "")
            if status in _FAILED:
                raise SessionFailed(f"session {session_id} is {status}")
            time.sleep(_POLL_SECONDS)

    def delete(self, session_id: str) -> None:
        try:
            self._call("DELETE", f"/session/{session_id}")
        except (SessionFailed, OSError) as error:
            # ponytail: a missed delete is swept by name on the next run and counted there.
            print(f"delete {session_id} failed: {error}", flush=True)


def _wait_answers(url: str, timeout: float) -> None:
    """Poll ``url`` until it answers HTTP 200: the notebook server is up behind the ingress."""
    while True:
        try:
            with urllib.request.urlopen(url, timeout=timeout) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(_POLL_SECONDS)


@perfpulse
def spawn_session() -> dict[str, float]:
    """Launch one 1-core, 1 GiB session, wait until it is ready, and delete it.

    Ready means Running for a headless session, and Running plus its URL answering for a
    notebook. ``swept_sessions`` counts leftovers of earlier runs found by name: above 0 means
    a run died before its cleanup.
    """
    skaha = _Skaha()
    kind = os.environ.get("SESSION_TYPE", "headless")
    name = f"perfpulse-{os.environ.get('PERFPULSE_PROBE', 'spawn-session')}".lower()
    swept = skaha.sweep(name)
    started = time.monotonic()
    session_id = skaha.create(name, kind, os.environ["SESSION_IMAGE"])
    created = time.monotonic()
    try:
        connect_url = skaha.wait_running(session_id)
        running = ready = time.monotonic()
        if kind == "notebook":
            _wait_answers(connect_url, skaha.timeout)
            ready = time.monotonic()
    finally:
        skaha.delete(session_id)
    return {
        "create_seconds": created - started,
        "running_seconds": running - created,
        "ready_seconds": ready - created,
        "swept_sessions": swept,
    }
