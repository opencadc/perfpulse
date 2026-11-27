"""perfpulse: run one decorated function once and push what it returns to Prometheus over OTLP.

Public surface: the ``perfpulse`` decorator and the ``perfpulse <module>:<function>`` command.

One process is one run of one probe and one OTLP export. Kubernetes owns schedule, deadline,
placement and history (one CronJob per probe, ``concurrencyPolicy: Forbid``). Nothing here
loops, sleeps between runs or keeps state.
"""

from __future__ import annotations

import argparse
import importlib
import inspect
import json
import math
import multiprocessing
import os
import re
import signal
import sys
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Literal

__all__ = ["perfpulse"]

type Probe = Callable[[], Mapping[str, int | float]]
type Series = dict[str, float]

# Function names, keys and `<function>_<key>`. Nothing to escape under any OTLP translation.
_NAME = re.compile(r"[a-z][a-z0-9]*(_[a-z0-9]+)*")

# A key ends in a base unit (seconds, bytes, ratio, bytes_per_second) or a plural noun.
_BAD_LAST_TOKEN = frozenset(
    {"total", "count", "sum", "bucket", "created", "info"}  # Prometheus type suffixes
    | {"ms", "us", "ns", "milliseconds", "minutes", "hours", "days"}  # non-base time
    | {"kb", "mb", "gb", "tb", "kib", "mib", "gib", "tib", "percent", "pct"}  # non-base size
)

_MARK = "__perfpulse__"
_GRACE_SECONDS = 20.0


def perfpulse(fn: Probe) -> Probe:
    """Mark ``fn`` as a probe and return it unchanged.

    The function name is the metric name prefix: key ``k`` becomes the gauge ``<fn>_<k>``.
    Calling the function directly (a test, a REPL) runs it with no perfpulse machinery.
    Probe modules must not start threads or create OpenTelemetry providers at import: the
    runner forks after importing, and the OTel SDK's after-fork hook deadlocks in the child.

    Args:
        fn: A synchronous function with no parameters that returns ``str`` to number.

    Returns:
        ``fn`` itself.

    Raises:
        TypeError: ``fn`` takes any parameter (defaults included) or is ``async``.
        ValueError: The name is not lowercase snake_case or starts with ``perfpulse``.
    """
    if inspect.signature(fn).parameters:
        raise TypeError(f"probe {fn.__name__!r} must take no parameters")
    if inspect.iscoroutinefunction(fn) or inspect.isasyncgenfunction(fn):
        raise TypeError(f"probe {fn.__name__!r} must not be async")
    name = fn.__name__
    if not _NAME.fullmatch(name):
        raise ValueError(f"probe name {name!r} must match {_NAME.pattern}")
    if name.startswith("perfpulse"):
        raise ValueError(f"probe name {name!r} must not start with 'perfpulse'")
    setattr(fn, _MARK, True)
    return fn


@dataclass(frozen=True, slots=True)
class _Ok:
    values: Series
    seconds: float


@dataclass(frozen=True, slots=True)
class _Failed:
    reason: Literal["raised", "timeout", "crashed", "bad_return"]
    detail: str
    seconds: float


def _validate(function: str, returned: object) -> Series:
    """Parse a probe's return value, all or nothing; raise TypeError/ValueError naming the key."""
    if not isinstance(returned, Mapping):
        raise TypeError(f"expected a mapping, got {type(returned).__name__}")
    out: Series = {}
    for key, value in returned.items():
        if not isinstance(key, str) or not _NAME.fullmatch(key):
            raise ValueError(f"key {key!r} must match {_NAME.pattern}")
        if key.rsplit("_", 1)[-1] in _BAD_LAST_TOKEN:
            raise ValueError(f"key {key!r} ends in a type suffix or a non-base unit")
        if isinstance(value, bool) or not isinstance(value, int | float):
            raise TypeError(f"key {key!r}: value must be int or float, not {type(value).__name__}")
        try:
            number = float(value)
        except OverflowError:
            raise ValueError(f"key {key!r}: value does not fit a float") from None
        if not math.isfinite(number):
            raise ValueError(f"key {key!r}: value must be finite")
        out[f"{function}_{key}"] = number
    return out


class _Deadline(BaseException):
    """Raised in the child on SIGTERM, so a probe's ``except Exception`` cannot swallow it."""


class _ParentTerm(Exception):
    """SIGTERM to the parent: pod deletion or ``activeDeadlineSeconds``."""


def _raise_deadline(signum: int, frame: object) -> None:
    raise _Deadline


def _raise_parent_term(signum: int, frame: object) -> None:
    raise _ParentTerm


def _child(fn: Probe, writer) -> None:
    # SIGTERM is blocked across fork (see _supervise): install the handler, then unblock.
    signal.signal(signal.SIGTERM, _raise_deadline)
    signal.signal(signal.SIGINT, signal.SIG_DFL)
    signal.pthread_sigmask(signal.SIG_UNBLOCK, {signal.SIGTERM})
    try:
        try:
            returned = fn()
        except _Deadline:
            message = ("timeout", "probe did not finish before the deadline")
        except Exception as error:  # noqa: BLE001 - every probe failure is an outcome
            message = ("raised", f"{type(error).__name__}: {error}")
        else:
            try:
                message = ("ok", _validate(fn.__name__, returned))
            except (TypeError, ValueError) as error:
                message = ("bad_return", str(error))
        writer.send(message)
    except _Deadline:
        try:
            writer.send(("timeout", "deadline reached while reporting"))
        except BaseException:  # noqa: BLE001, S110 - the parent reports the timeout anyway
            pass
    finally:
        writer.close()


def _supervise(fn: Probe, timeout: float, grace: float = _GRACE_SECONDS) -> _Ok | _Failed:
    """Run ``fn`` in a forked child and always return an outcome; never raises.

    A hang or segfault in the child is still reported by the parent. An OOM kill usually is
    not: on cgroup v2 the kernel kills every process in the container, and the failed Job
    (``kube_job_status_failed``) reports that case instead.
    """
    ctx = multiprocessing.get_context("fork")  # macOS defaults to spawn, 3.14 Linux to forkserver
    reader, writer = ctx.Pipe(duplex=False)
    started = time.monotonic()
    previous = signal.getsignal(signal.SIGTERM)
    signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGTERM})
    try:
        child = ctx.Process(target=_child, args=(fn, writer), daemon=True)
        child.start()
        signal.signal(signal.SIGTERM, _raise_parent_term)
    except Exception as error:  # noqa: BLE001
        signal.pthread_sigmask(signal.SIG_UNBLOCK, {signal.SIGTERM})
        return _Failed("crashed", f"could not start child: {error}", time.monotonic() - started)
    finally:
        writer.close()  # or EOF never arrives when the child dies, and a crash looks like a timeout
    signal.pthread_sigmask(signal.SIG_UNBLOCK, {signal.SIGTERM})

    timed_out = False
    message = None
    try:
        try:
            ready = reader.poll(timeout)
        except _ParentTerm:
            ready = False
        if not ready:
            # The parent decides "timeout": a probe that swallows BaseException never reports.
            timed_out = True
            child.terminate()
            try:
                ready = reader.poll(grace)
            except _ParentTerm:
                ready = False
            if not ready:
                child.kill()
        try:
            message = reader.recv() if ready else None
        except (EOFError, OSError, _ParentTerm):
            message = None
        child.join()
    finally:
        signal.signal(signal.SIGTERM, previous)
        reader.close()
    seconds = time.monotonic() - started

    if timed_out:
        return _Failed("timeout", f"exceeded {timeout}s (child exit {child.exitcode})", seconds)
    if message is None:
        return _Failed("crashed", f"child exited with {child.exitcode} without reporting", seconds)
    kind, payload = message
    if kind == "ok":
        return _Ok(payload, seconds)
    return _Failed(kind, payload, seconds)


def _series(outcome: _Ok | _Failed) -> Series:
    """Map one outcome to what Prometheus stores: the whole naming contract."""
    if isinstance(outcome, _Ok):
        return {
            **outcome.values,
            "perfpulse_probe_success": 1.0,
            "perfpulse_probe_duration_seconds": outcome.seconds,
        }
    return {"perfpulse_probe_success": 0.0, "perfpulse_probe_duration_seconds": outcome.seconds}


def _push(series: Series, *, installation: str, probe: str, node: str | None) -> bool:
    """Export ``series`` once as unitless OTLP gauges; return whether Prometheus accepted them.

    The resource holds exactly ``service.namespace``, ``service.name`` and
    ``service.instance.id``, built with ``Resource(...)`` rather than ``Resource.create`` so no
    SDK or ``OTEL_RESOURCE_ATTRIBUTES`` attributes reach the receiver. Prometheus then stores
    ``job="<installation>/perfpulse"`` and ``instance=<probe>``, and writes no ``target_info``.
    Node probes add only a ``node`` point attribute, which keeps one writer per series.
    ``MeterProvider.force_flush`` reports success even when the push failed, so this calls the
    exporter directly and checks its result.
    """
    from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
    from opentelemetry.sdk.metrics import MeterProvider
    from opentelemetry.sdk.metrics.export import InMemoryMetricReader, MetricExportResult
    from opentelemetry.sdk.resources import Resource

    resource = Resource(
        {
            "service.namespace": installation,
            "service.name": "perfpulse",
            "service.instance.id": probe,
        }
    )
    reader = InMemoryMetricReader()
    provider = MeterProvider(resource=resource, metric_readers=[reader])
    try:
        meter = provider.get_meter("perfpulse")
        attributes = {"node": node} if node else {}
        for name, value in series.items():
            meter.create_gauge(name).set(value, attributes)
        data = reader.get_metrics_data()
    finally:
        provider.shutdown()
    exporter = OTLPMetricExporter()
    try:
        return exporter.export(data) is MetricExportResult.SUCCESS
    except Exception:  # noqa: BLE001 - any export error means nothing was reported
        return False
    finally:
        exporter.shutdown()


def _log(**fields: object) -> None:
    print(json.dumps(fields, sort_keys=True), file=sys.stderr)


def _resolve(reference: str) -> Probe | str:
    """Return the decorated function ``module:function`` names, or why it cannot be used."""
    module_name, sep, function = reference.partition(":")
    if not sep or not module_name or not function:
        return "expected <module>:<function>"
    try:
        module = importlib.import_module(module_name)
    except Exception as error:  # noqa: BLE001
        return f"{type(error).__name__}: {error}"
    fn = getattr(module, function, None)
    if not callable(fn) or not getattr(fn, _MARK, False):
        return "not a @perfpulse function"
    return fn


def main(argv: list[str] | None = None) -> int:
    """Run ``perfpulse <module>:<function> [--dry-run]``: one probe, once.

    Environment (set by the chart): ``PERFPULSE_INSTALLATION`` (required unless
    ``--dry-run``), ``PERFPULSE_PROBE`` (the values key; default the function name),
    ``PERFPULSE_TIMEOUT`` (seconds, default 300), ``PERFPULSE_NODE`` (node probes),
    ``OTEL_EXPORTER_OTLP_ENDPOINT`` and ``OTEL_EXPORTER_OTLP_TIMEOUT``.

    Args:
        argv: Command-line arguments; ``sys.argv[1:]`` when omitted.

    Returns:
        0 when the probe succeeded and was reported, 1 when it failed and the failure was
        reported, 2 when nothing was reported (bad reference or settings, push rejected).
    """
    parser = argparse.ArgumentParser(prog="perfpulse", description="Run one probe once.")
    parser.add_argument("reference", help="<module>:<function> of a @perfpulse function")
    parser.add_argument("--dry-run", action="store_true", help="print the series, do not push")
    args = parser.parse_args(argv)

    fn = _resolve(args.reference)
    if isinstance(fn, str):
        _log(event="bad_reference", reference=args.reference, detail=fn)
        return 2
    installation = os.environ.get("PERFPULSE_INSTALLATION", "")
    if not installation and not args.dry_run:
        _log(event="missing_installation")
        return 2
    try:
        timeout = float(os.environ.get("PERFPULSE_TIMEOUT", "300"))
    except ValueError:
        _log(event="bad_timeout", value=os.environ.get("PERFPULSE_TIMEOUT"))
        return 2
    probe = os.environ.get("PERFPULSE_PROBE") or fn.__name__
    node = os.environ.get("PERFPULSE_NODE") or None

    outcome = _supervise(fn, timeout)
    series = _series(outcome)
    ok = isinstance(outcome, _Ok)
    record: dict[str, object] = {
        "event": "run",
        "probe": probe,
        "reference": args.reference,
        "outcome": "ok" if ok else outcome.reason,
        "seconds": round(outcome.seconds, 3),
    }
    if not ok:
        record["detail"] = outcome.detail

    if args.dry_run:
        for name, value in series.items():
            print(f"{name} {value!r}")
        _log(**record, pushed=False)
        return 0 if ok else 1

    pushed = _push(series, installation=installation, probe=probe, node=node)
    _log(**record, pushed=pushed)
    if not pushed:
        return 2
    return 0 if ok else 1
