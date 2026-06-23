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
  test("emits lifecycle stage callbacks through running and opportunistic completion", () => {
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
      ["completed", 600],
    ]);
  });

  test("submits a suspended Kueue Job and reports running evidence", () => {
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
    expect(result.admissionLatencyMs).toBeUndefined();
    expect(result.completed).toBe(true);
    expect(result.completionLatencyMs).toBe(600);
    expect(createdManifests).toHaveLength(1);
    expect(createdManifests[0]?.spec.suspend).toBe(true);
    expect(createdManifests[0]?.metadata.labels["kueue.x-k8s.io/queue-name"]).toBe("cadc-default");
  });

  test("succeeds for cron once the Kueue Job is running without waiting for admission or completion", () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      SURFACE: "k8s-kueue",
      TESTID: "kueue-spot",
    });
    const lifecycleEvents: string[] = [];
    const client = createClient({
      listJobsByTestId() {
        return {
          items: [
            {
              metadata: { name: config.jobName },
              status: { active: 1, conditions: [] },
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
    const poller: PollUntil = (_timeout, _interval, read, done) => {
      const value = read();
      return done(value) ? value : undefined;
    };

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

  test("succeeds after running for benchmark without require completion", () => {
    const config = resolveRunConfig({
      CONFIRM_HIGH_USERS: "true",
      LOGICAL_USERS: "100",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      RUN_CLASS: "benchmark",
      SURFACE: "k8s-kueue",
      TOTAL_JOBS: "10000",
      TESTID: "benchmark-kueue",
    });
    const lifecycleEvents: string[] = [];
    const client = createClient({
      listJobsByTestId() {
        return {
          items: [
            {
              metadata: { name: config.jobName },
              status: { active: 1, conditions: [] },
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

  test("does not treat a merely created Kueue Job as running", () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      RUN_CLASS: "cron",
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
      category: "visibility",
      message: `Kueue Job ${config.jobName} was not running within ${config.visibilityGateSeconds}s`,
      stage: "job-visibility",
    });
    expect(result.jobVisible).toBe(false);
    expect(result.workloadVisible).toBe(false);
    expect(result.admitted).toBe(false);
    expect(result.completed).toBe(false);
    expect(lifecycleEvents).toEqual(["submitted", "failure:visibility"]);
  });

  test("accepts visible Workloads without requiring admission", () => {
    const config = resolveRunConfig({
      LOGICAL_USERS: "1",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      RUN_CLASS: "benchmark",
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
    expect(pollCount).toBe(2);
  });

  test("refreshes Job status until it is running instead of using a stale created snapshot", () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      SURFACE: "k8s-kueue",
      TESTID: "kueue-spot",
    });
    let jobListCalls = 0;
    const client = createClient({
      listJobsByTestId() {
        jobListCalls += 1;
        if (jobListCalls === 1) {
          return {
            items: [
              {
                metadata: { name: config.jobName },
                status: { conditions: [] },
              },
            ],
          };
        }
        return {
          items: [
            {
              metadata: { name: config.jobName },
              status: { active: 1, conditions: [] },
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
                conditions: [{ status: "True", type: "Admitted" }],
              },
            },
          ],
        };
      },
    });
    let pollCalls = 0;
    const poller: PollUntil = (_timeout, _interval, read, done) => {
      pollCalls += 1;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const value = read();
        if (done(value)) {
          return value;
        }
      }
      return undefined;
    };

    const result = runKueueKubernetesSurface(
      config,
      { admissionGateSeconds: 120, priorityClass: "low", queueName: "cadc-default" },
      client,
      poller,
      () => pollCalls * 100,
    );

    expect(result.failure).toBeUndefined();
    expect(result.admitted).toBe(true);
    expect(result.completed).toBe(false);
    expect(jobListCalls).toBeGreaterThan(1);
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
