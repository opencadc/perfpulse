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

    const result = runDirectKubernetesSurface(config, client, poller, () => 10);

    expect(result.failure).toBeUndefined();
    expect(result.createResponse.status).toBe(201);
    expect(result.visible).toBe(true);
    expect(result.completed).toBe(true);
    expect(createdManifests).toHaveLength(1);
    expect(createdManifests[0]?.metadata.name).toBe("perfpulse-kind-smoke-0");
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

  test("reports completion failure when the visible Job reaches Failed", () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      TESTID: "kind-smoke",
    });
    const client = createClient({
      listJobsByTestId() {
        return {
          items: [
            {
              metadata: { name: "perfpulse-kind-smoke-0" },
              status: { conditions: [{ status: "True", type: "Failed" }] },
            },
          ],
        };
      },
    });
    const poller: PollUntil = (_timeout, _interval, read) => read();

    const result = runDirectKubernetesSurface(config, client, poller, () => 10);

    expect(result.failure).toEqual({
      message: "Kubernetes Job perfpulse-kind-smoke-0 did not complete within 120s",
      stage: "completion",
    });
    expect(result.visible).toBe(true);
    expect(result.completed).toBe(false);
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
              metadata: { name: "perfpulse-kind-smoke-0" },
              status: { conditions: [{ status: "True", type: "Complete" }] },
            },
          ],
        }
      );
    },
  };
}
