import { describe, expect, test } from "bun:test";
import { resolveRunConfig } from "../src/config";
import { buildDirectJobManifest } from "../src/kubernetes/job";
import { KUBERNETES_LABEL_KEYS } from "../src/labels";

describe("direct Kubernetes Job manifest", () => {
  test("builds the M0.5 no-Kueue workload manifest", () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      TESTID: "kind-smoke",
      WORKLOAD_DURATION_SECONDS: "3",
    });
    const manifest = buildDirectJobManifest(config);

    expect(manifest.apiVersion).toBe("batch/v1");
    expect(manifest.kind).toBe("Job");
    expect(manifest.metadata.name).toBe("perfpulse-kind-smoke-0");
    expect(manifest.metadata.namespace).toBe("canfar-workloads");
    expect(manifest.metadata.labels[KUBERNETES_LABEL_KEYS.testid]).toBe("kind-smoke");
    expect(manifest.metadata.labels["kueue.x-k8s.io/queue-name"]).toBeUndefined();
    expect(manifest.spec.backoffLimit).toBe(0);
    expect(manifest.spec.template.spec.restartPolicy).toBe("Never");
    expect(manifest.spec.template.spec.containers[0]?.image).toBe("docker.io/alexeiled/stress-ng");
    expect(manifest.spec.template.spec.containers[0]?.command).toBeUndefined();
    expect(manifest.spec.template.spec.containers[0]?.args).toEqual([
      "--cpu",
      "1",
      "--timeout",
      "3s",
      "--metrics-brief",
    ]);
  });
});
