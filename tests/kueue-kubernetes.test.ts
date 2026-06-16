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
  test("emits lifecycle stage callbacks through admission and completion", () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      SURFACE: "k8s-kueue",
      TESTID: "kueue-spot",
    });
    const lifecycleEvents: Array<[string, number | string | undefined]> = [];
    const timestamps = [0, 100, 250, 400, 700];
    const poller: PollUntil = (_timeout, _interval, read, done) => {
      const value = read();
      expect(done(value)).toBe(true);
      return value;
    };

    runKueueKubernetesSurface(
      config,
      { admissionGateSeconds: 120, priorityClass: "low", queueName: "cadc-default" },
      createClient(),
      poller,
      () => timestamps.shift() ?? 700,
      {
        recordAdmission(admissionLatencyMs) {
          lifecycleEvents.push(["admission", admissionLatencyMs]);
        },
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
      },
    );

    expect(lifecycleEvents).toEqual([
      ["submitted", 100],
      ["visible", 150],
      ["admission", 600],
      ["completed", 600],
    ]);
  });

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
    expect(result.completed).toBe(true);
    expect(result.completionLatencyMs).toBe(600);
    expect(createdManifests).toHaveLength(1);
    expect(createdManifests[0]?.spec.suspend).toBe(true);
    expect(createdManifests[0]?.metadata.labels["kueue.x-k8s.io/queue-name"]).toBe("cadc-default");
  });

  test("succeeds after workload visibility for stress without require completion", () => {
    const config = resolveRunConfig({
      CAMPAIGN_TYPE: "stress",
      CONFIRM_HIGH_USERS: "true",
      CONFIRM_STRESS: "true",
      LOGICAL_USERS: "100",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      PROFILE: "campaign",
      SURFACE: "k8s-kueue",
      TOTAL_JOBS: "10000",
      TESTID: "stress-kueue",
    });
    const lifecycleEvents: string[] = [];
    const client = createClient({
      listJobsByTestId() {
        return {
          items: [
            {
              metadata: { name: config.jobName },
              status: { conditions: [{ status: "True", type: "Failed" }] },
            },
          ],
        };
      },
      listWorkloadsByTestId() {
        return {
          items: [
            {
              metadata: {
                ownerReferences: [{ kind: "Job", name: config.jobName }],
              },
              status: {
                conditions: [{ status: "False", type: "Admitted" }],
              },
            },
          ],
        };
      },
    });
    const poller: PollUntil = (_timeout, _interval, read) => read();

    const result = runKueueKubernetesSurface(
      config,
      { admissionGateSeconds: 120, priorityClass: "low", queueName: "cadc-default" },
      client,
      poller,
      () => 10,
      {
        recordAdmission() {
          lifecycleEvents.push("admission");
        },
        recordCompleted() {
          lifecycleEvents.push("completed");
        },
        recordFailure(stage) {
          lifecycleEvents.push(`failure:${stage}`);
        },
        recordSubmitted() {
          lifecycleEvents.push("submitted");
        },
        recordVisible() {
          lifecycleEvents.push("visible");
        },
      },
    );

    expect(result.failure).toBeUndefined();
    expect(result.jobVisible).toBe(true);
    expect(result.workloadVisible).toBe(true);
    expect(result.admitted).toBe(false);
    expect(result.completed).toBe(false);
    expect(lifecycleEvents).toEqual(["submitted", "visible"]);
  });

  test("hard-fails cron checks when workload is never admitted within the admission gate", () => {
    const config = resolveRunConfig({
      KUEUE_ADMISSION_GATE_SECONDS: "5",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      PROFILE: "cron",
      SURFACE: "k8s-kueue",
      TESTID: "cron-kueue",
    });
    const lifecycleEvents: string[] = [];
    const client = createClient({
      listJobsByTestId() {
        return {
          items: [
            {
              metadata: { name: config.jobName },
              status: { conditions: [] },
            },
          ],
        };
      },
      listWorkloadsByTestId() {
        return {
          items: [
            {
              metadata: {
                ownerReferences: [{ kind: "Job", name: config.jobName }],
              },
              status: {
                conditions: [{ status: "False", type: "Admitted" }],
              },
            },
          ],
        };
      },
    });
    let pollCount = 0;
    const poller: PollUntil = (_timeout, _interval, read, done) => {
      pollCount += 1;
      const value = read();
      if (pollCount <= 2) {
        return done(value) ? value : undefined;
      }
      return undefined;
    };

    const result = runKueueKubernetesSurface(
      config,
      {
        admissionGateSeconds: config.kueue.admissionGateSeconds,
        priorityClass: "low",
        queueName: "cadc-default",
      },
      client,
      poller,
      () => 10,
      {
        recordAdmission() {
          lifecycleEvents.push("admission");
        },
        recordCompleted() {
          lifecycleEvents.push("completed");
        },
        recordFailure(stage) {
          lifecycleEvents.push(`failure:${stage}`);
        },
        recordSubmitted() {
          lifecycleEvents.push("submitted");
        },
        recordVisible() {
          lifecycleEvents.push("visible");
        },
      },
    );

    expect(result.failure).toEqual({
      category: "kueue-admission",
      message: `Kueue Workload for Job ${config.jobName} was not admitted within ${config.kueue.admissionGateSeconds}s`,
      stage: "admission",
    });
    expect(result.jobVisible).toBe(true);
    expect(result.workloadVisible).toBe(true);
    expect(result.admitted).toBe(false);
    expect(result.completed).toBe(false);
    expect(lifecycleEvents).toEqual(["submitted", "visible", "failure:admission"]);
  });

  test("accepts visible Workloads without requiring admission", () => {
    const config = resolveRunConfig({
      CAMPAIGN_TYPE: "benchmark",
      LOGICAL_USERS: "1",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      PROFILE: "campaign",
      SURFACE: "k8s-kueue",
      TESTID: "kueue-spot",
      TOTAL_JOBS: "100",
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

    expect(result.failure).toBeUndefined();
    expect(result.jobVisible).toBe(true);
    expect(result.workloadVisible).toBe(true);
    expect(result.admitted).toBe(false);
    expect(result.completed).toBe(true);
    expect(pollCount).toBe(3);
  });

  test("emits a visibility failure callback when the Job never appears", () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      SURFACE: "k8s-kueue",
      TESTID: "kueue-spot",
    });
    const lifecycleEvents: Array<[string, number | string | undefined]> = [];
    const poller: PollUntil = () => undefined;

    const result = runKueueKubernetesSurface(
      config,
      { admissionGateSeconds: 120, priorityClass: "low", queueName: "cadc-default" },
      createClient(),
      poller,
      () => 10,
      {
        recordAdmission(admissionLatencyMs) {
          lifecycleEvents.push(["admission", admissionLatencyMs]);
        },
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
      },
    );

    expect(result.failure?.stage).toBe("job-visibility");
    expect(lifecycleEvents).toEqual([
      ["submitted", 0],
      ["failure", "visibility"],
    ]);
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
          items: [
            {
              metadata: { name: "perfpulse-kueue-spot-kueue-0" },
              status: { conditions: [{ status: "True", type: "Complete" }] },
            },
          ],
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
