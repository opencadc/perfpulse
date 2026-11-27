import math
import os
import signal
import socket
import sys
import textwrap
import threading
import time

import pytest

import perfpulse as pp
from perfpulse import _Failed, _Ok


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for key in list(os.environ):
        if key.startswith(("PERFPULSE_", "OTEL_")):
            monkeypatch.delenv(key)
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TIMEOUT", "2")


# naming


def test_name_is_function_underscore_key():
    assert pp._validate("f", {"k": 1, "ready_seconds": 2.5}) == {"f_k": 1.0, "f_ready_seconds": 2.5}


@pytest.mark.parametrize(
    "key",
    [
        "x_total",
        "x_count",
        "x_bucket",
        "x_ms",
        "x_gib",
        "x_percent",
        "Ready_seconds",
        "readySeconds",
        "1x",
        "a__b",
        "a-b",
        "",
    ],
)
def test_rejects_bad_keys(key):
    with pytest.raises(ValueError):
        pp._validate("f", {key: 1})


@pytest.mark.parametrize("value", [True, False, math.nan, math.inf, -math.inf, "1", None, 10**400])
def test_rejects_bad_values(value):
    with pytest.raises((TypeError, ValueError)):
        pp._validate("f", {"k": value})


@pytest.mark.parametrize("returned", [None, 1.0, [("k", 1)], "k", {1: 1}])
def test_rejects_non_mapping_or_non_str_key(returned):
    with pytest.raises((TypeError, ValueError)):
        pp._validate("f", returned)


def test_all_or_nothing():
    def mixed():
        return {"good_seconds": 1, "bad_ms": 2}

    out = pp._supervise(mixed, timeout=5)
    assert isinstance(out, _Failed) and out.reason == "bad_return" and "bad_ms" in out.detail
    assert pp._series(out).keys() == {"perfpulse_probe_success", "perfpulse_probe_duration_seconds"}


# decorator


def test_decorator_marks_and_returns_unchanged():
    def arc_copy():
        return {"seconds": 1}

    assert pp.perfpulse(arc_copy) is arc_copy
    assert getattr(arc_copy, pp._MARK) is True
    assert arc_copy() == {"seconds": 1}


def test_decorator_rejects_parameters_and_async():
    def takes(x):
        return {}

    def takes_default(x=1):
        return {}

    async def coroutine():
        return {}

    for fn in (takes, takes_default, coroutine):
        with pytest.raises(TypeError):
            pp.perfpulse(fn)


@pytest.mark.parametrize(
    "name", ["Bad", "badName", "_private", "a__b", "perfpulse_x", "perfpulsex"]
)
def test_decorator_rejects_names(name):
    def fn():
        return {}

    fn.__name__ = name
    with pytest.raises(ValueError):
        pp.perfpulse(fn)


def test_decorator_rejects_lambda():
    with pytest.raises(ValueError):
        pp.perfpulse(lambda: {})


# supervise


def test_supervise_ok():
    def good():
        return {"ready_seconds": 1.5}

    out = pp._supervise(good, timeout=5)
    assert isinstance(out, _Ok) and out.values == {"good_ready_seconds": 1.5} and out.seconds > 0


def test_supervise_raised():
    def boom():
        raise RuntimeError("nope")

    out = pp._supervise(boom, timeout=5)
    assert isinstance(out, _Failed) and out.reason == "raised" and "nope" in out.detail


def test_timeout_runs_finally_despite_except_exception(tmp_path):
    marker = tmp_path / "finally"

    def stubborn():
        try:
            try:
                time.sleep(60)
            except Exception:
                pass
            time.sleep(60)
        finally:
            marker.write_text("ran")
        return {}

    started = time.monotonic()
    out = pp._supervise(stubborn, timeout=0.5, grace=5)
    assert isinstance(out, _Failed) and out.reason == "timeout"
    assert marker.read_text() == "ran"
    assert time.monotonic() - started < 3 and out.seconds >= 0.5


def test_timeout_kills_after_grace_when_probe_eats_baseexception():
    def immortal():
        while True:
            try:
                time.sleep(60)
            except BaseException:
                pass

    started = time.monotonic()
    out = pp._supervise(immortal, timeout=0.3, grace=0.5)
    assert isinstance(out, _Failed) and out.reason == "timeout" and "-9" in out.detail
    assert time.monotonic() - started < 3


def test_crashed_on_sigkill_and_os_exit():
    def sigkill():
        os.kill(os.getpid(), signal.SIGKILL)

    def exits():
        os._exit(3)

    out = pp._supervise(sigkill, timeout=5)
    assert isinstance(out, _Failed) and out.reason == "crashed" and "-9" in out.detail
    out = pp._supervise(exits, timeout=5)
    assert out.reason == "crashed" and "3" in out.detail


def test_bad_return():
    def bad():
        return [1, 2]

    out = pp._supervise(bad, timeout=5)
    assert isinstance(out, _Failed) and out.reason == "bad_return" and out.seconds > 0


def test_parent_sigterm_reaches_child_and_takes_timeout_path(tmp_path):
    marker = tmp_path / "finally"

    def slow():
        try:
            time.sleep(60)
        finally:
            marker.write_text("ran")

    parent = os.getpid()
    threading.Timer(0.5, lambda: os.kill(parent, signal.SIGTERM)).start()
    started = time.monotonic()
    out = pp._supervise(slow, timeout=30, grace=5)
    assert out.reason == "timeout" and marker.read_text() == "ran"
    assert time.monotonic() - started < 5
    assert signal.getsignal(signal.SIGTERM) is not pp._raise_parent_term


def test_series_shapes():
    assert pp._series(_Ok({"f_k": 2.0}, 1.0)) == {
        "f_k": 2.0,
        "perfpulse_probe_success": 1.0,
        "perfpulse_probe_duration_seconds": 1.0,
    }
    assert pp._series(_Failed("raised", "x", 3.0)) == {
        "perfpulse_probe_success": 0.0,
        "perfpulse_probe_duration_seconds": 3.0,
    }


# push


def _attrs(kvs):
    return {kv.key: kv.value.string_value for kv in kvs}


def test_push_resource_is_exact_and_values_are_unitless_gauges(otlp, monkeypatch):
    monkeypatch.setenv("OTEL_RESOURCE_ATTRIBUTES", "evil=1,service.name=other")
    monkeypatch.setenv("OTEL_SERVICE_NAME", "other")
    pushed = pp._push(
        {"f_ready_seconds": 1.5, "perfpulse_probe_success": 1.0},
        installation="inst",
        probe="spawn-notebook",
        node=None,
    )
    assert pushed is True
    [(path, request)] = otlp.requests
    assert path == "/v1/metrics"
    [rm] = request.resource_metrics
    assert _attrs(rm.resource.attributes) == {
        "service.namespace": "inst",
        "service.name": "perfpulse",
        "service.instance.id": "spawn-notebook",
    }
    metrics = {m.name: m for sm in rm.scope_metrics for m in sm.metrics}
    assert set(metrics) == {"f_ready_seconds", "perfpulse_probe_success"}
    for metric in metrics.values():
        assert metric.WhichOneof("data") == "gauge" and metric.unit == ""
        [point] = metric.gauge.data_points
        assert len(point.attributes) == 0
    assert metrics["f_ready_seconds"].gauge.data_points[0].as_double == 1.5


def test_push_node_probe_adds_only_a_point_attribute(otlp):
    assert pp._push({"disk_read_bytes_per_second": 9.0}, installation="i", probe="disk", node="n1")
    [(_, request)] = otlp.requests
    rm = request.resource_metrics[0]
    assert _attrs(rm.resource.attributes)["service.instance.id"] == "disk"
    [point] = rm.scope_metrics[0].metrics[0].gauge.data_points
    assert _attrs(point.attributes) == {"node": "n1"}


@pytest.mark.parametrize("status", [400, 503])
def test_push_rejected(otlp, status):
    otlp.status = status
    assert pp._push({"x_seconds": 1.0}, installation="i", probe="p", node=None) is False


def test_push_connection_refused(monkeypatch):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", f"http://127.0.0.1:{port}")
    assert pp._push({"x_seconds": 1.0}, installation="i", probe="p", node=None) is False


def test_force_flush_reports_success_on_a_rejected_push(otlp):
    """Why _push calls export() directly."""
    from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
    from opentelemetry.sdk.metrics import MeterProvider
    from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader

    otlp.status = 400
    reader = PeriodicExportingMetricReader(OTLPMetricExporter(), export_interval_millis=10**9)
    provider = MeterProvider(metric_readers=[reader])
    provider.get_meter("t").create_gauge("g").set(1)
    assert provider.force_flush() is True
    assert len(otlp.requests) == 1
    provider.shutdown()


# main


@pytest.fixture
def probes_module(tmp_path, monkeypatch):
    name = f"probes_{os.getpid()}_{time.monotonic_ns()}"
    (tmp_path / f"{name}.py").write_text(
        textwrap.dedent(
            """
            from perfpulse import perfpulse

            @perfpulse
            def good():
                return {"ready_seconds": 1.0}

            @perfpulse
            def bad():
                raise RuntimeError("x")

            def undecorated():
                return {}
            """
        )
    )
    monkeypatch.syspath_prepend(str(tmp_path))
    yield name
    sys.modules.pop(name, None)


def _names(request):
    rm = request.resource_metrics[0]
    return {m.name for sm in rm.scope_metrics for m in sm.metrics}


def test_main_ok_exits_0(probes_module, otlp, monkeypatch):
    monkeypatch.setenv("PERFPULSE_INSTALLATION", "inst")
    monkeypatch.setenv("PERFPULSE_PROBE", "spawn-notebook")
    assert pp.main([f"{probes_module}:good"]) == 0
    request = otlp.requests[0][1]
    assert _names(request) == {
        "good_ready_seconds",
        "perfpulse_probe_success",
        "perfpulse_probe_duration_seconds",
    }
    attrs = _attrs(request.resource_metrics[0].resource.attributes)
    assert attrs["service.instance.id"] == "spawn-notebook"


def test_main_probe_failed_exits_1_and_reports(probes_module, otlp, monkeypatch):
    monkeypatch.setenv("PERFPULSE_INSTALLATION", "inst")
    assert pp.main([f"{probes_module}:bad"]) == 1
    request = otlp.requests[0][1]
    assert _names(request) == {"perfpulse_probe_success", "perfpulse_probe_duration_seconds"}
    assert _attrs(request.resource_metrics[0].resource.attributes)["service.instance.id"] == "bad"


@pytest.mark.parametrize(
    "ref",
    ["nocolon", "no_such_module_xyz:good", "{mod}:undecorated", "{mod}:missing", ":good", "{mod}:"],
)
def test_main_bad_reference_exits_2(probes_module, otlp, monkeypatch, ref):
    monkeypatch.setenv("PERFPULSE_INSTALLATION", "inst")
    assert pp.main([ref.format(mod=probes_module)]) == 2
    assert otlp.requests == []


def test_main_missing_installation_exits_2(probes_module, otlp):
    assert pp.main([f"{probes_module}:good"]) == 2
    assert otlp.requests == []


def test_main_push_rejected_exits_2(probes_module, otlp, monkeypatch):
    monkeypatch.setenv("PERFPULSE_INSTALLATION", "inst")
    otlp.status = 400
    assert pp.main([f"{probes_module}:good"]) == 2
    assert pp.main([f"{probes_module}:bad"]) == 2


def test_main_dry_run_prints_and_does_not_push(probes_module, otlp, capsys):
    assert pp.main([f"{probes_module}:good", "--dry-run"]) == 0
    out = capsys.readouterr().out
    assert "good_ready_seconds 1.0" in out and "perfpulse_probe_success 1.0" in out
    assert pp.main([f"{probes_module}:bad", "--dry-run"]) == 1
    assert otlp.requests == []
