import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

CHART = Path(__file__).parent.parent / "chart"

pytestmark = pytest.mark.skipif(shutil.which("helm") is None, reason="needs helm")

VALUES = """
installation: canfar-skaha-prod
authSecret: perfpulse-auth
env: {SKAHA_URL: https://ws-uv.canfar.net/skaha/v1}
workload:
  namespace: canfar-workloads
  queue: cadc-default
  arcClaim: canfar-workloads-production-pvc
  nodeSelector: {skaha.opencadc.org/node-pool: cadc}
probes:
  spawn-notebook:
    function: perfpulse.probes.skaha:spawn_session
    schedule: "*/10 * * * *"
    timeout: 900
    env: {SESSION_TYPE: notebook}
  arc-copy:
    function: perfpulse.probes.storage:arc_scratch_copy
    schedule: "17 * * * *"
    workload: true
  disk-bench:
    function: perfpulse.probes.node:disk_benchmark
    schedule: "0 3 * * *"
    workload: true
    nodes: 3
  removed: null
"""


def render(tmp_path, values=VALUES, check=True):
    path = tmp_path / "values.yaml"
    path.write_text(values)
    result = subprocess.run(
        ["helm", "template", "pp", str(CHART), "-n", "canfar-system-production", "-f", str(path)],
        capture_output=True,
        text=True,
        check=False,
    )
    if check:
        assert result.returncode == 0, result.stderr
        return {d["metadata"]["name"]: d for d in yaml.safe_load_all(result.stdout) if d}
    return result


def pod(cronjob):
    return cronjob["spec"]["jobTemplate"]["spec"]["template"]["spec"]


def env(cronjob):
    return {
        e["name"]: e.get("value", e.get("valueFrom")) for e in pod(cronjob)["containers"][0]["env"]
    }


def test_one_cronjob_per_probe(tmp_path):
    docs = render(tmp_path)
    assert set(docs) == {"pp-spawn-notebook", "pp-arc-copy", "pp-disk-bench"}
    for cronjob in docs.values():
        assert cronjob["spec"]["concurrencyPolicy"] == "Forbid"
        assert cronjob["spec"]["jobTemplate"]["spec"]["backoffLimit"] == 0
        spec = pod(cronjob)
        assert spec["securityContext"]["runAsNonRoot"] is True
        assert spec["terminationGracePeriodSeconds"] > 20 + 10
        container = spec["containers"][0]
        assert container["securityContext"]["capabilities"]["drop"] == ["ALL"]


def test_api_probe(tmp_path):
    cronjob = render(tmp_path)["pp-spawn-notebook"]
    assert cronjob["metadata"]["namespace"] == "canfar-system-production"
    assert cronjob["spec"]["jobTemplate"]["spec"]["activeDeadlineSeconds"] == 990
    container = pod(cronjob)["containers"][0]
    assert container["args"] == ["perfpulse.probes.skaha:spawn_session"]
    assert container["envFrom"] == [{"secretRef": {"name": "perfpulse-auth"}}]
    assert {
        "PERFPULSE_INSTALLATION": "canfar-skaha-prod",
        "PERFPULSE_PROBE": "spawn-notebook",
        "PERFPULSE_TIMEOUT": "900",
        "SESSION_TYPE": "notebook",
        "SKAHA_URL": "https://ws-uv.canfar.net/skaha/v1",
    }.items() <= env(cronjob).items()
    assert "kueue.x-k8s.io/queue-name" not in cronjob["spec"]["jobTemplate"]["metadata"]["labels"]


def test_workload_probe_runs_in_the_session_namespace_through_kueue(tmp_path):
    cronjob = render(tmp_path)["pp-arc-copy"]
    assert cronjob["metadata"]["namespace"] == "canfar-workloads"
    labels = cronjob["spec"]["jobTemplate"]["metadata"]["labels"]
    assert labels["kueue.x-k8s.io/queue-name"] == "cadc-default"
    spec = pod(cronjob)
    assert spec["nodeSelector"] == {"skaha.opencadc.org/node-pool": "cadc"}
    container = spec["containers"][0]
    assert "envFrom" not in container
    assert {"name": "arc", "mountPath": "/arc", "subPath": "cavern"} in container["volumeMounts"]
    claim = {v["name"]: v for v in spec["volumes"]}["arc"]["persistentVolumeClaim"]["claimName"]
    assert claim == "canfar-workloads-production-pvc"
    assert container["resources"]["requests"]["cpu"] == "1"


def test_node_probe_spreads_one_pod_per_node(tmp_path):
    cronjob = render(tmp_path)["pp-disk-bench"]
    job = cronjob["spec"]["jobTemplate"]["spec"]
    assert job["completions"] == job["parallelism"] == 3
    term = pod(cronjob)["affinity"]["podAntiAffinity"][
        "requiredDuringSchedulingIgnoredDuringExecution"
    ][0]
    assert term["topologyKey"] == "kubernetes.io/hostname"
    assert env(cronjob)["PERFPULSE_NODE"] == {"fieldRef": {"fieldPath": "spec.nodeName"}}


@pytest.mark.parametrize(
    ("values", "message"),
    [
        ("probes: {}", "installation is required"),
        ("installation: x\nprobes: {Bad: {function: a:b, schedule: '* * * * *'}}", "DNS-safe"),
        ("installation: x\nprobes: {a: {schedule: '* * * * *'}}", "function is required"),
        (
            "installation: x\nprobes: {a: {function: a:b, schedule: '* * * * *', workload: true}}",
            "workload.namespace is required",
        ),
    ],
)
def test_render_fails_loudly(tmp_path, values, message):
    result = render(tmp_path, values, check=False)
    assert result.returncode != 0 and message in result.stderr
