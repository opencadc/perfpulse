import { describe, expect, test } from "bun:test";
import { resolveRunConfig } from "../src/config";
import type { KubernetesJobManifest } from "../src/kubernetes/job";
import {
  type KueueKubernetesClient,
  type KueueResponseLike,
  type PollUntil,
  runKueueKubernetesSurface,
  type WorkloadListLike,
} from "../src/kubernetes/kueue";
import type { JobListLike } from "../src/kubernetes/status";

describe("direct Kubernetes Kueue surface", () => {
  test("submits a suspended Kueue Job and reports Workload admission", () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      SURFACE: "k8s-kueue",
      TESTID: "kueue-spot",
    });
    const createdManifests: KubernetesJobManifest[] = [];
    const client = createClient({
      createJob(manifest) {
        createdManifests.push(manifest);
        return { body: "created", status: 201 };
      },
    });
    const poller: PollUntil = (_timeout, _interval, read, done) => {
      const value = read();
      expect(done(value)).toBe(true);
      return value;
    };

    const timestamps = [0, 100, 250, 400, 700];
    const result = runKueueKubernetesSurface(
      config,
      { admissionGateSeconds: 120, priorityClass: "low", queueName: "cadc-default" },
      client,
      poller,
      () => timestamps.shift() ?? 700,
    );

    expect(result.failure).toBeUndefined();
    expect(result.createResponse.status).toBe(201);
    expect(result.submissionDurationMs).toBe(100);
    expect(result.jobVisible).toBe(true);
    expect(result.visibilityLatencyMs).toBe(150);
    expect(result.workloadVisible).toBe(true);
    expect(result.workloadVisibilityLatencyMs).toBe(300);
    expect(result.admitted).toBe(true);
    expect(result.admissionLatencyMs).toBe(600);
    expect(createdManifests).toHaveLength(1);
    expect(createdManifests[0]?.spec.suspend).toBe(true);
    expect(createdManifests[0]?.metadata.labels["kueue.x-k8s.io/queue-name"]).toBe("cadc-default");
  });

  test("reports visible-but-not-admitted Workloads as hard Kueue admission failures", () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      SURFACE: "k8s-kueue",
      TESTID: "kueue-spot",
    });
    let pollCount = 0;
    const client = createClient({
      listWorkloadsByTestId() {
        return {
          items: [
            {
              metadata: {
                ownerReferences: [{ kind: "Job", name: "perfpulse-kueue-spot-kueue-0" }],
              },
              status: {
                conditions: [{ status: "False", type: "Admitted" }],
              },
            },
          ],
        };
      },
    });
    const poller: PollUntil = (_timeout, _interval, read, done) => {
      pollCount += 1;
      const value = read();
      return done(value) ? value : undefined;
    };

    const result = runKueueKubernetesSurface(
      config,
      { admissionGateSeconds: 120, priorityClass: "low", queueName: "cadc-default" },
      client,
      poller,
      () => 10,
    );

    expect(result.failure).toEqual({
      category: "kueue-admission",
      message: "Kueue Workload was visible but not admitted within 120s",
      stage: "admission",
    });
    expect(result.jobVisible).toBe(true);
    expect(result.workloadVisible).toBe(true);
    expect(result.admitted).toBe(false);
    expect(pollCount).toBe(3);
  });
});

function createClient(overrides: Partial<KueueKubernetesClient> = {}): KueueKubernetesClient {
  return {
    createJob(manifest: KubernetesJobManifest): KueueResponseLike {
      return overrides.createJob?.(manifest) ?? { body: "created", status: 201 };
    },
    listJobsByTestId(): JobListLike {
      return (
        overrides.listJobsByTestId?.() ?? {
          items: [{ metadata: { name: "perfpulse-kueue-spot-kueue-0" } }],
        }
      );
    },
    listWorkloadsByTestId(): WorkloadListLike {
      return (
        overrides.listWorkloadsByTestId?.() ?? {
          items: [
            {
              metadata: {
                ownerReferences: [{ kind: "Job", name: "perfpulse-kueue-spot-kueue-0" }],
              },
              status: {
                conditions: [{ status: "True", type: "Admitted" }],
              },
            },
          ],
        }
      );
    },
  };
}
