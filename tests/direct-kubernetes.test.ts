import { describe, expect, test } from "bun:test";
import { resolveRunConfig } from "../src/config";
import {
  type DirectKubernetesClient,
  type KubernetesResponseLike,
  type PollUntil,
  runDirectKubernetesSurface,
} from "../src/kubernetes/direct";
import type { KubernetesJobManifest } from "../src/kubernetes/job";
import type { JobListLike } from "../src/kubernetes/status";

describe("direct Kubernetes Test surface", () => {
  test("emits lifecycle stage callbacks as the Job advances", () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      TESTID: "kind-smoke",
    });
    const lifecycleEvents: Array<[string, number | string | undefined]> = [];
    const timestamps = [0, 100, 250, 600];
    const poller: PollUntil = (_timeout, _interval, read, done) => {
      const list = read();
      expect(done(list)).toBe(true);
      return list;
    };

    runDirectKubernetesSurface(config, createClient(), poller, () => timestamps.shift() ?? 600, {
      recordCompleted(completionLatencyMs) {
        lifecycleEvents.push(["completed", completionLatencyMs]);
      },
      recordFailure(stage) {
        lifecycleEvents.push(["failure", stage]);
      },
      recordSubmitted(submissionDurationMs) {
        lifecycleEvents.push(["submitted", submissionDurationMs]);
      },
      recordVisible(visibilityLatencyMs) {
        lifecycleEvents.push(["visible", visibilityLatencyMs]);
      },
    });

    expect(lifecycleEvents).toEqual([
      ["submitted", 100],
      ["visible", 150],
      ["completed", 500],
    ]);
  });

  test("submits exactly one direct Job and reports completion through labels", () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      TESTID: "kind-smoke",
    });
    const createdManifests: KubernetesJobManifest[] = [];
    const client = createClient({
      createJob(manifest) {
        createdManifests.push(manifest);
        return { body: "created", status: 201 };
      },
    });
    const poller: PollUntil = (_timeout, _interval, read, done) => {
      const list = read();
      expect(done(list)).toBe(true);
      return list;
    };

    const timestamps = [0, 100, 250, 600];
    const result = runDirectKubernetesSurface(
      config,
      client,
      poller,
      () => timestamps.shift() ?? 600,
    );

    expect(result.failure).toBeUndefined();
    expect(result.createResponse.status).toBe(201);
    expect(result.submissionDurationMs).toBe(100);
    expect(result.visible).toBe(true);
    expect(result.visibilityLatencyMs).toBe(150);
    expect(result.completed).toBe(true);
    expect(result.completionLatencyMs).toBe(500);
    expect(createdManifests).toHaveLength(1);
    expect(createdManifests[0]?.metadata.name).toBe("perfpulse-kind-smoke-direct-0");
    expect(createdManifests[0]?.metadata.labels["kueue.x-k8s.io/queue-name"]).toBeUndefined();
  });

  test("stops before polling when Job submission fails", () => {
    const config = resolveRunConfig({ PERF_PULSE_CLIENT_MODE: "kubernetes" });
    const client = createClient({
      createJob() {
        return { body: "forbidden", status: 403 };
      },
    });
    const poller: PollUntil = () => {
      throw new Error("poller should not run after failed submission");
    };

    const result = runDirectKubernetesSurface(config, client, poller, () => 10);

    expect(result.failure).toEqual({
      message: "Kubernetes Job create failed with HTTP 403: forbidden",
      stage: "submission",
    });
    expect(result.visible).toBe(false);
    expect(result.completed).toBe(false);
  });

  test("fails when a visible Job reaches Failed", () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      TESTID: "kind-smoke",
    });
    const client = createClient({
      listJobsByTestId() {
        return {
          items: [
            {
              metadata: { name: "perfpulse-kind-smoke-direct-0" },
              status: { conditions: [{ status: "True", type: "Failed" }] },
            },
          ],
        };
      },
    });
    const poller: PollUntil = (_timeout, _interval, read) => read();

    const result = runDirectKubernetesSurface(config, client, poller, () => 10);

    expect(result.failure).toEqual({
      message: "Kubernetes Job perfpulse-kind-smoke-direct-0 reached Failed",
      stage: "completion",
    });
    expect(result.visible).toBe(true);
    expect(result.completed).toBe(false);
  });

  test("emits a visibility failure callback before returning a timeout", () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      TESTID: "kind-smoke",
    });
    const lifecycleEvents: Array<[string, number | string | undefined]> = [];
    const poller: PollUntil = () => undefined;

    const result = runDirectKubernetesSurface(config, createClient(), poller, () => 10, {
      recordCompleted(completionLatencyMs) {
        lifecycleEvents.push(["completed", completionLatencyMs]);
      },
      recordFailure(stage) {
        lifecycleEvents.push(["failure", stage]);
      },
      recordSubmitted(submissionDurationMs) {
        lifecycleEvents.push(["submitted", submissionDurationMs]);
      },
      recordVisible(visibilityLatencyMs) {
        lifecycleEvents.push(["visible", visibilityLatencyMs]);
      },
    });

    expect(result.failure?.stage).toBe("visibility");
    expect(lifecycleEvents).toEqual([
      ["submitted", 0],
      ["failure", "visibility"],
    ]);
  });
});

function createClient(overrides: Partial<DirectKubernetesClient> = {}): DirectKubernetesClient {
  return {
    createJob(manifest: KubernetesJobManifest): KubernetesResponseLike {
      return overrides.createJob?.(manifest) ?? { body: "created", status: 201 };
    },
    listJobsByTestId(): JobListLike {
      return (
        overrides.listJobsByTestId?.() ?? {
          items: [
            {
              metadata: { name: "perfpulse-kind-smoke-direct-0" },
              status: { conditions: [{ status: "True", type: "Complete" }] },
            },
          ],
        }
      );
    },
  };
}
