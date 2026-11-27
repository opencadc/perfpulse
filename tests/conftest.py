import gc
import http.server
import threading

import pytest
from opentelemetry.proto.collector.metrics.v1.metrics_service_pb2 import (
    ExportMetricsServiceRequest,
)


class OtlpReceiver:
    """A stdlib OTLP/HTTP endpoint that records each request and answers ``status``."""

    def __init__(self):
        self.status = 200
        self.requests: list[tuple[str, ExportMetricsServiceRequest]] = []
        outer = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers["Content-Length"]))
                request = ExportMetricsServiceRequest()
                request.ParseFromString(body)
                outer.requests.append((self.path, request))
                self.send_response(outer.status)
                self.send_header("Content-Length", "0")
                self.end_headers()

            def log_message(self, *args):
                pass

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture(autouse=True)
def no_live_meter_providers():
    """Collect MeterProviders left by earlier tests before any test forks.

    The OTel SDK registers an after-fork hook per live MeterProvider that deadlocks in the
    child. The runner itself forks before OTel is loaded; only a test process has both.
    """
    gc.collect()


@pytest.fixture
def otlp(monkeypatch):
    receiver = OtlpReceiver()
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", receiver.url)
    yield receiver
    receiver.close()
