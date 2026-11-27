import http.server
import importlib
import json
import pkgutil
import threading
import urllib.parse

import pytest

import perfpulse
import perfpulse.probes
from perfpulse.probes import node, skaha, storage


class FakeSkaha:
    """Just enough Skaha: list, create (plain-text id), poll, delete, and a notebook URL."""

    def __init__(self, statuses=("Pending", "Running"), create_status=200, url_codes=(200,)):
        self.sessions: dict[str, dict] = {}
        self.requests: list[tuple[str, str, dict, dict]] = []
        self.statuses = list(statuses)
        self.create_status = create_status
        self.url_codes = list(url_codes)
        outer = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def _send(self, code, body=b"", content_type="text/plain"):
                self.send_response(code)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _record(self):
                parsed = urllib.parse.urlparse(self.path)
                query = dict(urllib.parse.parse_qsl(parsed.query))
                outer.requests.append((self.command, parsed.path, query, dict(self.headers)))
                return parsed.path, query

            def do_GET(self):
                path, _ = self._record()
                if path == "/skaha/v1/session":
                    self._send(200, json.dumps(list(outer.sessions.values())).encode())
                elif path.startswith("/skaha/v1/session/"):
                    session = outer.sessions.get(path.rsplit("/", 1)[1])
                    if session is None:
                        self._send(404)
                        return
                    if outer.statuses:
                        session["status"] = outer.statuses.pop(0)
                    self._send(200, json.dumps(session).encode(), "application/json")
                elif path.startswith("/notebook/"):
                    code = (
                        outer.url_codes.pop(0) if len(outer.url_codes) > 1 else outer.url_codes[0]
                    )
                    self._send(code)

            def do_POST(self):
                _, query = self._record()
                if outer.create_status != 200:
                    self._send(outer.create_status, b"registry lookup failed")
                    return
                session_id = f"s{len(outer.sessions) + 1}"
                outer.sessions[session_id] = {
                    "id": session_id,
                    "name": query["name"],
                    "status": "Pending",
                    "connectURL": f"{outer.base}/notebook/{session_id}/lab?token={session_id}",
                }
                self._send(200, f"{session_id}\n".encode())

            def do_DELETE(self):
                path, _ = self._record()
                outer.sessions.pop(path.rsplit("/", 1)[1], None)
                self._send(200)

            def log_message(self, *args):
                pass

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()


@pytest.fixture
def fake(monkeypatch):
    def start(**kwargs):
        server = FakeSkaha(**kwargs)
        monkeypatch.setenv("SKAHA_URL", f"{server.base}/skaha/v1")
        monkeypatch.setenv("CANFAR_TOKEN", "t0ken")
        monkeypatch.setenv("SESSION_IMAGE", "images.canfar.net/skaha/terminal:1.1")
        monkeypatch.setenv("PERFPULSE_PROBE", "spawn-headless")
        monkeypatch.setattr(skaha, "_POLL_SECONDS", 0.01)
        servers.append(server)
        return server

    servers = []
    yield start
    for server in servers:
        server.server.shutdown()


def _calls(server, method):
    return [r for r in server.requests if r[0] == method]


def test_headless_spawn_follows_the_contract_and_deletes(fake):
    server = fake()
    values = skaha.spawn_session()
    assert set(values) == {"create_seconds", "running_seconds", "ready_seconds", "swept_sessions"}
    assert values["swept_sessions"] == 0 and values["ready_seconds"] == values["running_seconds"]
    [(_, path, query, headers)] = _calls(server, "POST")
    assert path == "/skaha/v1/session"
    assert query == {
        "name": "perfpulse-spawn-headless",
        "image": "images.canfar.net/skaha/terminal:1.1",
        "type": "headless",
        "cores": "1",
        "ram": "1",
        "cmd": "sleep",
        "args": "600",
    }
    assert headers["Authorization"] == "Bearer t0ken"
    assert headers["X-Skaha-Authentication-Type"] == "RUNTIME-TOKEN"
    assert headers["Content-Type"] == "application/x-www-form-urlencoded"
    assert server.sessions == {}


def test_notebook_waits_until_its_url_answers(fake, monkeypatch):
    server = fake(url_codes=(503, 503, 200))
    monkeypatch.setenv("SESSION_TYPE", "notebook")
    values = skaha.spawn_session()
    notebook_gets = [r for r in _calls(server, "GET") if r[1].startswith("/notebook/")]
    assert len(notebook_gets) == 3
    assert values["ready_seconds"] >= values["running_seconds"]
    assert "cmd" not in _calls(server, "POST")[0][2]


def test_sweep_deletes_a_leftover_with_the_same_name(fake):
    server = fake()
    server.sessions["old"] = {"id": "old", "name": "perfpulse-spawn-headless", "status": "Running"}
    server.sessions["user"] = {"id": "user", "name": "notebook-of-a-human", "status": "Running"}
    values = skaha.spawn_session()
    assert values["swept_sessions"] == 1
    assert set(server.sessions) == {"user"}


def test_failed_session_raises_and_is_still_deleted(fake):
    server = fake(statuses=("Pending", "Failed"))
    with pytest.raises(skaha.SessionFailed, match="Failed"):
        skaha.spawn_session()
    assert server.sessions == {}


def test_rejected_create_raises_with_skaha_body(fake):
    fake(create_status=404)
    with pytest.raises(skaha.SessionFailed, match="HTTP 404: registry lookup failed"):
        skaha.spawn_session()


def test_deadline_still_deletes_the_session(fake):
    server = fake(statuses=("Pending",) * 100_000)
    outcome = perfpulse._supervise(skaha.spawn_session, timeout=1, grace=5)
    assert outcome.reason == "timeout"
    assert server.sessions == {}
    assert _calls(server, "DELETE")


# storage


def test_arc_scratch_copy_times_four_copies_and_cleans_up(tmp_path, monkeypatch):
    arc, scratch = tmp_path / "arc", tmp_path / "scratch"
    arc.mkdir()
    scratch.mkdir()
    (arc / "perfpulse-arc-copy").mkdir()  # a dead run's leftover
    monkeypatch.setenv("ARC_DIR", str(arc))
    monkeypatch.setenv("SCRATCH_DIR", str(scratch))
    monkeypatch.setenv("LARGE_FILE_BYTES", str(3 * (1 << 20) + 5))
    values = storage.arc_scratch_copy()
    assert set(values) == {
        "small_to_arc_seconds",
        "large_to_arc_seconds",
        "small_to_scratch_seconds",
        "large_to_scratch_seconds",
    }
    assert all(v > 0 for v in values.values())
    assert list(arc.iterdir()) == [] and list(scratch.iterdir()) == []


def test_arc_usage_reads_rstats_and_statvfs(tmp_path, monkeypatch):
    for area in ("home", "projects"):
        (tmp_path / area).mkdir()
    stats = {"home": (10, 2), "projects": (300, 40)}
    monkeypatch.setattr(
        storage,
        "_rstat",
        lambda path, name: stats[path.name][0 if name.endswith("rbytes") else 1],
    )
    monkeypatch.setenv("ARC_ROOT", str(tmp_path))
    values = storage.arc_usage()
    assert values["home_bytes"] == 10 and values["projects_files"] == 40
    assert values["capacity_bytes"] > 0 and 0 <= values["used_ratio"] <= 1


def test_vospace_listing_times_both_urls(fake, monkeypatch):
    server = fake()
    monkeypatch.setenv("VOSPACE_HOME_URL", f"{server.base}/skaha/v1/session")
    monkeypatch.setenv("VOSPACE_PROJECTS_URL", f"{server.base}/skaha/v1/session")
    values = storage.vospace_listing()
    assert set(values) == {"home_seconds", "projects_seconds"}
    assert all(r[3]["Authorization"] == "Bearer t0ken" for r in _calls(server, "GET"))


# node


def test_node_benchmarks(tmp_path, monkeypatch):
    monkeypatch.setenv("CPU_BENCHMARK_BYTES", str(4 << 20))
    monkeypatch.setenv("DISK_BENCHMARK_BYTES", str(4 << 20))
    monkeypatch.setenv("SCRATCH_DIR", str(tmp_path))
    assert node.cpu_benchmark()["sha256_bytes_per_second"] > 0
    values = node.disk_benchmark()
    assert values["write_bytes_per_second"] > 0 and values["read_bytes_per_second"] > 0
    assert list(tmp_path.iterdir()) == []


# every built-in probe


def _builtin_probes():
    for info in pkgutil.iter_modules(perfpulse.probes.__path__):
        module = importlib.import_module(f"perfpulse.probes.{info.name}")
        for name, value in vars(module).items():
            if getattr(value, perfpulse._MARK, False):
                yield name


def test_no_probe_name_is_a_prefix_of_another():
    """`arc` + `copy_seconds` and `arc_copy` + `seconds` would both write `arc_copy_seconds`."""
    names = sorted(_builtin_probes())
    assert len(names) == len(set(names)) == 6
    for a in names:
        for b in names:
            assert a == b or not b.startswith(f"{a}_"), (a, b)
