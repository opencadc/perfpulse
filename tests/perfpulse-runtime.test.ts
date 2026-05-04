import { beforeEach, describe, expect, mock, test } from "bun:test";
import { resolveRunConfig } from "../src/config";
import { KUBERNETES_LABEL_KEYS } from "../src/labels";
import { METRIC_NAMES } from "../src/metrics-contract";

interface MetricRecord {
  metric: string;
  tags?: Record<string, string> | undefined;
  value: number;
}

interface HttpRequest {
  body?: string | null;
  method: string;
  options?:
    | {
        headers?: Record<string, string>;
        tags?: {
          name?: string;
        };
      }
    | undefined;
  url: string;
}

const metricRecords: MetricRecord[] = [];
const httpRequests: HttpRequest[] = [];

Reflect.set(globalThis, "__ENV", {});

mock.module("k6", () => ({
  check: () => true,
  fail: (message: string) => {
    throw new Error(message);
  },
  sleep: () => undefined,
}));

mock.module("k6/metrics", () => ({
  Counter: class Counter {
    readonly name: string;

    constructor(name: string) {
      this.name = name;
    }

    add(value: number, tags?: Record<string, string>): void {
      metricRecords.push({ metric: this.name, tags, value });
    }
  },
  Trend: class Trend {
    readonly name: string;

    constructor(name: string) {
      this.name = name;
    }

    add(value: number, tags?: Record<string, string>): void {
      metricRecords.push({ metric: this.name, tags, value });
    }
  },
}));

mock.module("k6/http", () => ({
  default: {
    del(url: string, body: string | null, options?: HttpRequest["options"]) {
      httpRequests.push({ body, method: "DELETE", options, url });
      return { body: "", status: 202 };
    },
    get(url: string, options?: HttpRequest["options"]) {
      httpRequests.push({ method: "GET", options, url });
      if (url.includes("/session/")) {
        return {
          body: JSON.stringify({ id: "session-runtime", status: "Completed" }),
          status: 200,
        };
      }
      if (url.includes("/apis/kueue.x-k8s.io/")) {
        return {
          body: JSON.stringify({
            items: [
              {
                metadata: {
                  ownerReferences: [{ kind: "Job", name: "perfpulse-kueue-spot-0" }],
                },
                status: {
                  conditions: [{ status: "True", type: "Admitted" }],
                },
              },
            ],
          }),
          status: 200,
        };
      }
      return {
        body: JSON.stringify({
          items: [
            {
              metadata: { name: "perfpulse-kueue-spot-0" },
              status: { conditions: [{ status: "True", type: "Complete" }] },
            },
          ],
        }),
        status: 200,
      };
    },
    post(url: string, body: string, options?: HttpRequest["options"]) {
      httpRequests.push({ body, method: "POST", options, url });
      if (url.includes("/session")) {
        return { body: "session-runtime", status: 200 };
      }
      return { body: "created", status: 201 };
    },
  },
}));

describe("PerfPulse k6 runtime dispatch", () => {
  beforeEach(() => {
    httpRequests.length = 0;
    metricRecords.length = 0;
  });

  test("runs the Kueue Kubernetes surface when runtime config selects k8s-kueue", async () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      PROFILE: "spot-tiny",
      SURFACE: "k8s-kueue",
      TESTID: "kueue-spot",
    });
    const runtime = await import("../src/perfpulse");

    runtime.default(config);

    expect(httpRequests.some((request) => request.options?.tags?.name === "k8s_create_job")).toBe(
      true,
    );
    expect(
      httpRequests.some((request) => request.options?.tags?.name === "k8s_list_workloads"),
    ).toBe(true);
    expect(metricRecords).toContainEqual({
      metric: METRIC_NAMES.kueueWorkloadsAdmitted,
      tags: expect.objectContaining({
        namespace: "canfar-workloads",
        surface: "k8s-kueue",
        testid: "kueue-spot",
      }),
      value: 1,
    });
    expect(metricRecords).toContainEqual({
      metric: METRIC_NAMES.kueueAdmissionLatencyMs,
      tags: expect.objectContaining({
        surface: "k8s-kueue",
        testid: "kueue-spot",
      }),
      value: expect.any(Number),
    });
    expect(httpRequests.find((request) => request.method === "POST")?.body).toContain(
      `"${KUBERNETES_LABEL_KEYS.surface}":"k8s-kueue"`,
    );
  });

  test("runs the Skaha surface with runtime API URL and token configuration", async () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      PROFILE: "spot-tiny",
      SKAHA_API_URL: "https://ws.example/skaha/v1",
      SKAHA_TOKEN: "runtime-secret",
      SURFACE: "skaha",
      TESTID: "skaha-spot",
    });
    const runtime = await import("../src/perfpulse");

    runtime.default(config);

    const createRequest = httpRequests.find(
      (request) => request.options?.tags?.name === "skaha_create_session",
    );
    expect(createRequest?.url).toBe("https://ws.example/skaha/v1/session");
    expect(createRequest?.options).toMatchObject({
      headers: {
        Authorization: "Bearer runtime-secret",
        "X-Skaha-Authentication-Type": "RUNTIME-TOKEN",
      },
    });
    expect(metricRecords).toContainEqual({
      metric: METRIC_NAMES.jobsSubmitted,
      tags: expect.objectContaining({
        surface: "skaha",
        testid: "skaha-spot",
      }),
      value: 1,
    });
    expect(metricRecords).toContainEqual({
      metric: METRIC_NAMES.jobsCompleted,
      tags: expect.objectContaining({
        surface: "skaha",
        testid: "skaha-spot",
      }),
      value: 1,
    });
    expect(JSON.stringify(metricRecords)).not.toContain("runtime-secret");
  });

  test("cleans up a Skaha session through the Skaha API when runtime state has a session id", async () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      PROFILE: "spot-tiny",
      SKAHA_API_URL: "https://ws.example/skaha/v1",
      SKAHA_TOKEN: "runtime-secret",
      SURFACE: "skaha",
      TESTID: "skaha-spot",
    });
    const runtime = await import("../src/perfpulse");

    runtime.default(config);
    httpRequests.length = 0;
    runtime.teardown(config);

    expect(httpRequests).toContainEqual(
      expect.objectContaining({
        method: "DELETE",
        options: expect.objectContaining({ tags: { name: "skaha_delete_session" } }),
        url: "https://ws.example/skaha/v1/session/session-runtime",
      }),
    );
    expect(httpRequests.some((request) => request.options?.tags?.name === "k8s_delete_job")).toBe(
      false,
    );
  });
});
