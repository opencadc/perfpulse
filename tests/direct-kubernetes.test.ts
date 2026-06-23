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

  test("succeeds for cron once the Job is running without waiting for completion", () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      TESTID: "kind-smoke",
    });
    const lifecycleEvents: string[] = [];
    const client = createClient({
      listJobsByTestId() {
        return {
          items: [
            {
              metadata: { name: "perfpulse-kind-smoke-direct-0" },
              status: { active: 1, conditions: [] },
            },
          ],
        };
      },
    });
    const poller: PollUntil = (_timeout, _interval, read, done) => {
      const value = read();
      return done(value) ? value : undefined;
    };

    const result = runDirectKubernetesSurface(config, client, poller, () => 10, {
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
    });

    expect(result.failure).toBeUndefined();
    expect(result.visible).toBe(true);
    expect(result.completed).toBe(false);
    expect(lifecycleEvents).toEqual(["submitted", "visible"]);
  });

  test("does not treat a merely created Job as running", () => {
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
              status: { conditions: [] },
            },
          ],
        };
      },
    });
    const poller: PollUntil = (_timeout, _interval, read, done) => {
      const value = read();
      return done(value) ? value : undefined;
    };

    const result = runDirectKubernetesSurface(config, client, poller, () => 10);

    expect(result.failure).toEqual({
      message: "Kubernetes Job perfpulse-kind-smoke-direct-0 was not running within 60s",
      stage: "visibility",
    });
    expect(result.visible).toBe(false);
    expect(result.completed).toBe(false);
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

  test("does not treat a failed Job as running", () => {
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
      message: "Kubernetes Job perfpulse-kind-smoke-direct-0 was not running within 60s",
      stage: "visibility",
    });
    expect(result.visible).toBe(false);
    expect(result.completed).toBe(false);
  });

  test("succeeds after running for benchmark without require completion", () => {
    const config = resolveRunConfig({
      CONFIRM_HIGH_USERS: "true",
      LOGICAL_USERS: "100",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      RUN_CLASS: "benchmark",
      SURFACE: "k8s-direct",
      TOTAL_JOBS: "10000",
      TESTID: "benchmark-direct",
    });
    const lifecycleEvents: string[] = [];
    const client = createClient({
      listJobsByTestId() {
        return {
          items: [
            {
              metadata: { name: "perfpulse-benchmark-direct-direct-0" },
              status: { active: 1, conditions: [] },
            },
          ],
        };
      },
    });
    const poller: PollUntil = (_timeout, _interval, read) => read();

    const result = runDirectKubernetesSurface(config, client, poller, () => 10, {
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
    });

    expect(result.failure).toBeUndefined();
    expect(result.visible).toBe(true);
    expect(result.completed).toBe(false);
    expect(lifecycleEvents).toEqual(["submitted", "visible"]);
  });

  test("refreshes Job status until it is running instead of using a stale created snapshot", () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      TESTID: "kind-smoke",
    });
    let listCalls = 0;
    const client = createClient({
      listJobsByTestId() {
        listCalls += 1;
        if (listCalls === 1) {
          return {
            items: [
              {
                metadata: { name: "perfpulse-kind-smoke-direct-0" },
                status: { conditions: [] },
              },
            ],
          };
        }
        return {
          items: [
            {
              metadata: { name: "perfpulse-kind-smoke-direct-0" },
              status: { active: 1, conditions: [] },
            },
          ],
        };
      },
    });
    const poller: PollUntil = (_timeout, _interval, read, done) => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const state = read();
        if (done(state)) {
          return state;
        }
      }
      return undefined;
    };

    const result = runDirectKubernetesSurface(config, client, poller, () => listCalls * 100);

    expect(result.completed).toBe(false);
    expect(result.visible).toBe(true);
    expect(result.failure).toBeUndefined();
    expect(listCalls).toBeGreaterThan(1);
  });

  test("treats a TTL-deleted Job as complete after it was visible", () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      TESTID: "ttl-gone",
    });
    let visiblePass = false;
    const client = createClient({
      getJob(_name: string) {
        return { body: "not found", status: 404 };
      },
      listJobsByTestId() {
        if (!visiblePass) {
          return {
            items: [
              {
                metadata: { name: "perfpulse-ttl-gone-direct-0" },
                status: { conditions: [{ status: "True", type: "Complete" }] },
              },
            ],
          };
        }
        return { items: [] };
      },
    });
    let pollCalls = 0;
    const poller: PollUntil = (_timeout, _interval, read, done) => {
      pollCalls += 1;
      const list = read();
      if (pollCalls === 1) {
        visiblePass = true;
        expect(done(list)).toBe(true);
        return list;
      }
      return done(list) ? list : undefined;
    };

    const result = runDirectKubernetesSurface(config, client, poller, () => pollCalls * 100);

    expect(result.completed).toBe(true);
    expect(result.failure).toBeUndefined();
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
    getJob(name: string): KubernetesResponseLike {
      return (
        overrides.getJob?.(name) ?? {
          body: JSON.stringify({
            metadata: { name },
            status: { conditions: [{ status: "True", type: "Complete" }] },
          }),
          status: 200,
        }
      );
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
