"""How does each node perform? Run with ``nodes: N`` so every pod lands on a different node.

Inputs (environment):
    CPU_BENCHMARK_BYTES: Bytes to hash; default 2**30.
    DISK_BENCHMARK_BYTES: Bytes to write and read back; default 2**30.
    SCRATCH_DIR: Where the disk benchmark writes; default ``/scratch``.
"""

from __future__ import annotations

import hashlib
import os
import time
from pathlib import Path

from perfpulse import perfpulse

_BLOCK = 1 << 20


@perfpulse
def cpu_benchmark() -> dict[str, float]:
    """Single-core sha256 throughput."""
    total = int(os.environ.get("CPU_BENCHMARK_BYTES", str(1 << 30)))
    block = os.urandom(_BLOCK)
    digest = hashlib.sha256()
    started = time.monotonic()
    for offset in range(0, total, _BLOCK):
        digest.update(block[: total - offset])
    return {"sha256_bytes_per_second": total / (time.monotonic() - started)}


@perfpulse
def disk_benchmark() -> dict[str, float]:
    """Sequential write (fsynced) and cold read throughput of the node's scratch disk."""
    total = int(os.environ.get("DISK_BENCHMARK_BYTES", str(1 << 30)))
    path = Path(os.environ.get("SCRATCH_DIR", "/scratch")) / "perfpulse-disk-benchmark"
    block = os.urandom(_BLOCK)
    try:
        started = time.monotonic()
        with path.open("wb") as handle:
            for offset in range(0, total, _BLOCK):
                handle.write(block[: total - offset])
            handle.flush()
            os.fsync(handle.fileno())
        write_seconds = time.monotonic() - started
        if hasattr(os, "posix_fadvise"):
            fd = os.open(path, os.O_RDONLY)
            os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
            os.close(fd)
        started = time.monotonic()
        with path.open("rb") as handle:
            while handle.read(_BLOCK):
                pass
        read_seconds = time.monotonic() - started
    finally:
        path.unlink(missing_ok=True)
    return {
        "write_bytes_per_second": total / write_seconds,
        "read_bytes_per_second": total / read_seconds,
    }
