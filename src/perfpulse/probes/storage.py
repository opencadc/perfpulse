"""Is user storage fast, and how full is it?

These run as ``workload`` probes: in the session namespace, with the /arc claim mounted the way
sessions mount it and an emptyDir at /scratch.

Inputs (environment):
    VOSPACE_HOME_URL, VOSPACE_PROJECTS_URL: Storage API URLs to list, e.g.
        ``https://ws-uv.canfar.net/arc/nodes/home/<user>``. CANFAR_TOKEN authenticates.
    ARC_DIR: Writable directory on /arc for ``arc_scratch_copy``.
    SCRATCH_DIR: Scratch directory; default ``/scratch``.
    LARGE_FILE_BYTES: Size of the large copy; default 10**9 (the science team's 1 GB).
    ARC_ROOT: /arc mount root for ``arc_usage``; ``home`` and ``projects`` sit under it.
"""

from __future__ import annotations

import os
import shutil
import time
import urllib.request
from pathlib import Path

from perfpulse import perfpulse

_SMALL_FILES = 100
_SMALL_BYTES = 1000
_BLOCK = 1 << 20


def _timed_get(url: str) -> float:
    request = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {os.environ['CANFAR_TOKEN']}"}
    )
    started = time.monotonic()
    with urllib.request.urlopen(request, timeout=600) as response:
        response.read()
    return time.monotonic() - started


@perfpulse
def vospace_listing() -> dict[str, float]:
    """Time the storage API listing /home and /projects, permission checks included."""
    return {
        "home_seconds": _timed_get(os.environ["VOSPACE_HOME_URL"]),
        "projects_seconds": _timed_get(os.environ["VOSPACE_PROJECTS_URL"]),
    }


def _drop_cache(path: Path) -> None:
    """Ask the kernel to forget ``path``'s pages, so the next read comes from storage."""
    if hasattr(os, "posix_fadvise"):
        fd = os.open(path, os.O_RDONLY)
        try:
            os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
        finally:
            os.close(fd)


def _copy(sources: list[Path], target: Path) -> float:
    """Copy ``sources`` into ``target`` with every file fsynced; return the seconds taken."""
    for source in sources:
        _drop_cache(source)
    started = time.monotonic()
    for source in sources:
        destination = target / source.name
        shutil.copyfile(source, destination)
        with destination.open("rb+") as handle:
            os.fsync(handle.fileno())
    return time.monotonic() - started


def _fresh(path: Path) -> Path:
    shutil.rmtree(path, ignore_errors=True)  # a dead run's leftovers go first
    path.mkdir(parents=True)
    return path


@perfpulse
def arc_scratch_copy() -> dict[str, float]:
    """Time copies between /arc and scratch: 100 files of 1 KB and one 1 GB file, both ways."""
    probe = os.environ.get("PERFPULSE_PROBE", "arc-copy")
    arc = Path(os.environ["ARC_DIR"]) / f"perfpulse-{probe}"
    scratch = Path(os.environ.get("SCRATCH_DIR", "/scratch")) / f"perfpulse-{probe}"
    large_bytes = int(os.environ.get("LARGE_FILE_BYTES", str(10**9)))
    try:
        source = _fresh(scratch / "source")
        small = []
        for i in range(_SMALL_FILES):
            path = source / f"small-{i:03d}"
            path.write_bytes(os.urandom(_SMALL_BYTES))
            small.append(path)
        large = source / "large"
        with large.open("wb") as handle:
            block = os.urandom(_BLOCK)
            for offset in range(0, large_bytes, _BLOCK):
                handle.write(block[: large_bytes - offset])
        on_arc = _fresh(arc)
        back = _fresh(scratch / "back")
        values = {
            "small_to_arc_seconds": _copy(small, on_arc),
            "large_to_arc_seconds": _copy([large], on_arc),
        }
        values["small_to_scratch_seconds"] = _copy([on_arc / p.name for p in small], back)
        values["large_to_scratch_seconds"] = _copy([on_arc / "large"], back)
        return values
    finally:
        shutil.rmtree(arc, ignore_errors=True)
        shutil.rmtree(scratch, ignore_errors=True)


def _rstat(path: Path, name: str) -> int:
    """Read a CephFS recursive statistic (``ceph.dir.rbytes``, ``ceph.dir.rfiles``)."""
    return int(os.getxattr(path, name))


@perfpulse
def arc_usage() -> dict[str, float]:
    """Report bytes and files under /arc home and projects, and the filesystem's fill."""
    root = Path(os.environ.get("ARC_ROOT", "/arc"))
    stat = os.statvfs(root)
    capacity = stat.f_blocks * stat.f_frsize
    used = (stat.f_blocks - stat.f_bfree) * stat.f_frsize
    values: dict[str, float] = {
        "capacity_bytes": capacity,
        "used_bytes": used,
        "used_ratio": used / capacity if capacity else 0.0,
    }
    for area in ("home", "projects"):
        values[f"{area}_bytes"] = _rstat(root / area, "ceph.dir.rbytes")
        values[f"{area}_files"] = _rstat(root / area, "ceph.dir.rfiles")
    return values
