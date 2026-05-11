import { beforeEach, describe, expect, mock, test } from "bun:test";
import { resolveRunConfig } from "../src/config";
import { KUBERNETES_LABEL_KEYS } from "../src/labels";
import { METRIC_NAMES, metricTags } from "../src/metrics-contract";

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
        } & Record<string, string>;
      }
    | undefined;
  url: string;
}

const metricRecords: MetricRecord[] = [];
const httpRequests: HttpRequest[] = [];
const createdJobs: Array<{ labels?: Record<string, string>; name: string }> = [];
const runtimeEvents: string[] = [];
const sleepCalls: number[] = [];
const deleteStatuses: number[] = [];
const sessionGetStatuses: number[] = [];
let listJobsStatus: number | undefined;
let iterationInTest = 0;
let workloadAdmitted = true;
let jobConditionType: "Complete" | "Failed" | undefined = "Complete";
let sessionStatus = "Completed";

Reflect.set(globalThis, "__ENV", {
  PERF_PULSE_CLIENT_MODE: "kubernetes",
  PROFILE: "cron",
  SKAHA_API_URL: "https://ws.example/skaha/v1",
  SKAHA_PASSWORD_PATH: "/var/run/secrets/perfpulse/skaha-auth/password",
  SKAHA_USERNAME_PATH: "/var/run/secrets/perfpulse/skaha-auth/username",
  SURFACE: "skaha",
  TESTID: "skaha-spot",
});
Reflect.set(globalThis, "open", (path: string) => {
  if (path.endsWith("/username")) {
    return "runtime-user\n";
  }
  if (path.endsWith("/password")) {
    return " runtime-password ";
  }
  return "service-account-token\n";
});

mock.module("k6", () => ({
  check: () => true,
  fail: (message: string) => {
    throw new Error(message);
  },
  sleep: (seconds: number) => {
    sleepCalls.push(seconds);
    runtimeEvents.push("sleep");
  },
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
  Gauge: class Gauge {
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
      return { body: "", status: deleteStatuses.shift() ?? 202 };
    },
    get(url: string, options?: HttpRequest["options"]) {
      httpRequests.push({ method: "GET", options, url });
      if (url.includes("/session/")) {
        const status = sessionGetStatuses.shift() ?? 200;
        return {
          body:
            status === 200 ? JSON.stringify({ id: "session-runtime", status: sessionStatus }) : "",
          status,
        };
      }
      if (url.includes("/apis/kueue.x-k8s.io/")) {
        const jobName = createdJobs.at(-1)?.name ?? "perfpulse-kueue-spot-kueue-0";
        return {
          body: JSON.stringify({
            items: [
              {
                metadata: {
                  ownerReferences: [{ kind: "Job", name: jobName }],
                },
                status: {
                  conditions: [{ status: workloadAdmitted ? "True" : "False", type: "Admitted" }],
                },
              },
            ],
          }),
          status: 200,
        };
      }
      if (listJobsStatus !== undefined) {
        return { body: "list refused", status: listJobsStatus };
      }
      const jobs =
        createdJobs.length > 0
          ? createdJobs
          : [
              {
                labels: { [KUBERNETES_LABEL_KEYS.surface]: "k8s-kueue" },
                name: "perfpulse-kueue-spot-kueue-0",
              },
            ];
      return {
        body: JSON.stringify({
          items: jobs.map((job) => ({
            metadata: { labels: job.labels, name: job.name },
            status: {
              conditions:
                jobConditionType === undefined ? [] : [{ status: "True", type: jobConditionType }],
            },
          })),
        }),
        status: 200,
      };
    },
    post(url: string, body: string, options?: HttpRequest["options"]) {
      httpRequests.push({ body, method: "POST", options, url });
      if (url === "https://ws-cadc.canfar.net/ac/login") {
        return { body: JSON.stringify("runtime-token"), status: 200 };
      }
      if (url.includes("/session")) {
        runtimeEvents.push("skaha_create_session");
        return { body: "session-runtime", status: 200 };
      }
      const manifest = JSON.parse(body);
      createdJobs.push({ labels: manifest.metadata.labels, name: manifest.metadata.name });
      return { body: "created", status: 201 };
    },
  },
}));

mock.module("k6/execution", () => ({
  scenario: {
    get iterationInTest() {
      return iterationInTest;
    },
  },
}));

mock.module("k6/encoding", () => ({
  b64encode(input: string) {
    return Buffer.from(input, "utf8").toString("base64");
  },
}));

describe("PerfPulse k6 runtime dispatch", () => {
  beforeEach(() => {
    httpRequests.length = 0;
    metricRecords.length = 0;
    createdJobs.length = 0;
    runtimeEvents.length = 0;
    sleepCalls.length = 0;
    deleteStatuses.length = 0;
    sessionGetStatuses.length = 0;
    listJobsStatus = undefined;
    iterationInTest = 0;
    workloadAdmitted = true;
    jobConditionType = "Complete";
    sessionStatus = "Completed";
  });

  test("runs the Kueue Kubernetes surface when runtime config selects k8s-kueue", async () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      PROFILE: "cron",
      SURFACE: "k8s-kueue",
      TESTID: "kueue-spot",
    });
    const runtime = await import("../src/perfpulse");

    runtime.default(config);

    expect(metricRecords).toContainEqual({
      metric: METRIC_NAMES.jobsExpected,
      tags: expect.objectContaining({
        namespace: "canfar-workloads",
        surface: "k8s-kueue",
        testid: "kueue-spot",
      }),
      value: 1,
    });
    expect(httpRequests.some((request) => request.options?.tags?.name === "k8s_create_job")).toBe(
      true,
    );
    expect(
      httpRequests.some((request) => request.options?.tags?.name === "k8s_list_workloads"),
    ).toBe(true);
    expect(
      httpRequests
        .filter((request) => request.options?.tags?.name?.startsWith("k8s_"))
        .map((request) => request.options?.tags),
    ).toEqual(
      expect.arrayContaining([
        { name: "k8s_create_job", ...metricTags(config) },
        { name: "k8s_list_jobs", ...metricTags(config) },
        { name: "k8s_list_workloads", ...metricTags(config) },
      ]),
    );
    expect(
      httpRequests.some(
        (request) =>
          request.options?.tags?.name === "k8s_list_jobs" &&
          request.url.includes("labelSelector=perfpulse.opencadc.org%2Ftestid%3Dkueue-spot"),
      ),
    ).toBe(true);
    expect(
      httpRequests.some(
        (request) =>
          request.options?.tags?.name === "k8s_list_workloads" &&
          request.url.includes("/apis/kueue.x-k8s.io/v1beta2/"),
      ),
    ).toBe(true);
    expect(
      httpRequests.every(
        (request) =>
          request.options?.tags?.name !== "k8s_list_workloads" ||
          !request.url.includes("labelSelector="),
      ),
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
    expect(sleepCalls).toEqual([]);
  });

  test("records stress Kueue visibility without hard-failing non-admission", async () => {
    workloadAdmitted = false;
    const config = resolveRunConfig({
      CONFIRM_STRESS: "true",
      KUEUE_ADMISSION_GATE_SECONDS: "1",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      POLL_INTERVAL_SECONDS: "1",
      CAMPAIGN_TYPE: "stress",
      CONFIRM_HIGH_USERS: "true",
      LOGICAL_USERS: "100",
      PROFILE: "campaign",
      TOTAL_JOBS: "10000",
      SURFACE: "k8s-kueue",
      TESTID: "stress-kueue",
    });
    const runtime = await import("../src/perfpulse");

    expect(() => runtime.default(config)).not.toThrow();

    expect(metricRecords).toContainEqual({
      metric: METRIC_NAMES.jobsSubmitted,
      tags: expect.objectContaining({ surface: "k8s-kueue", testid: "stress-kueue" }),
      value: 1,
    });
    expect(metricRecords).toContainEqual({
      metric: METRIC_NAMES.jobsVisible,
      tags: expect.objectContaining({ surface: "k8s-kueue", testid: "stress-kueue" }),
      value: 1,
    });
    expect(metricRecords).not.toContainEqual(
      expect.objectContaining({
        metric: METRIC_NAMES.kueueWorkloadsAdmissionFailed,
        value: 1,
      }),
    );
  });

  test("uses the k6 global iteration index for direct Kubernetes Job identity", async () => {
    iterationInTest = 75;
    const config = resolveRunConfig({
      LOGICAL_USERS: "2",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      CAMPAIGN_TYPE: "benchmark",
      PROFILE: "campaign",
      SURFACE: "k8s-direct",
      TESTID: "direct-benchmark",
      TOTAL_JOBS: "100",
    });
    const runtime = await import("../src/perfpulse");

    runtime.default(config);

    expect(metricRecords).toContainEqual({
      metric: METRIC_NAMES.jobsExpected,
      tags: expect.objectContaining({ surface: "k8s-direct", testid: "direct-benchmark" }),
      value: 100,
    });
    const createRequest = httpRequests.find(
      (request) => request.options?.tags?.name === "k8s_create_job",
    );
    const manifest = JSON.parse(createRequest?.body ?? "{}");
    expect(manifest.metadata.name).toBe("perfpulse-direct-benchmark-direct-75");
    expect(manifest.metadata.labels[KUBERNETES_LABEL_KEYS.userBucket]).toBe("bucket-1");
    expect(manifest.spec.template.metadata.labels[KUBERNETES_LABEL_KEYS.userBucket]).toBe(
      "bucket-1",
    );
    expect(JSON.stringify(metricRecords)).not.toContain("perfpulse-direct-benchmark-direct-75");
    expect(sleepCalls).toEqual([]);
  });

  test("records stress direct visibility without hard-failing incomplete Jobs", async () => {
    jobConditionType = undefined;
    const config = resolveRunConfig({
      COMPLETION_GATE_SECONDS: "1",
      CONFIRM_STRESS: "true",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      POLL_INTERVAL_SECONDS: "1",
      CAMPAIGN_TYPE: "stress",
      CONFIRM_HIGH_USERS: "true",
      LOGICAL_USERS: "100",
      PROFILE: "campaign",
      TOTAL_JOBS: "10000",
      SURFACE: "k8s-direct",
      TESTID: "stress-direct",
    });
    const runtime = await import("../src/perfpulse");

    expect(() => runtime.default(config)).not.toThrow();

    expect(metricRecords).toContainEqual({
      metric: METRIC_NAMES.jobsSubmitted,
      tags: expect.objectContaining({ surface: "k8s-direct", testid: "stress-direct" }),
      value: 1,
    });
    expect(metricRecords).toContainEqual({
      metric: METRIC_NAMES.jobsVisible,
      tags: expect.objectContaining({ surface: "k8s-direct", testid: "stress-direct" }),
      value: 1,
    });
    expect(metricRecords).not.toContainEqual(
      expect.objectContaining({
        metric: METRIC_NAMES.jobsCompletionFailed,
        value: 1,
      }),
    );
  });

  test("passes the derived user bucket into Kueue Job identity", async () => {
    iterationInTest = 75;
    const config = resolveRunConfig({
      LOGICAL_USERS: "2",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      CAMPAIGN_TYPE: "benchmark",
      PROFILE: "campaign",
      SURFACE: "k8s-kueue",
      TESTID: "kueue-benchmark",
      TOTAL_JOBS: "100",
    });
    const runtime = await import("../src/perfpulse");

    runtime.default(config);

    const createRequest = httpRequests.find(
      (request) => request.options?.tags?.name === "k8s_create_job",
    );
    const manifest = JSON.parse(createRequest?.body ?? "{}");
    expect(manifest.metadata.name).toBe("perfpulse-kueue-benchmark-kueue-75");
    expect(manifest.metadata.labels["canfar-net-sessionName"]).toBe(
      "perfpulse-kueue-benchmark-kueue-75",
    );
    expect(manifest.metadata.labels["canfar-net-userid"]).toBe("perfpulse-bucket-1");
    expect(manifest.metadata.labels[KUBERNETES_LABEL_KEYS.userBucket]).toBe("bucket-1");
  });

  test("creates distinct direct and Kueue Job names for the same benchmark testid", async () => {
    iterationInTest = 75;
    const directConfig = resolveRunConfig({
      LOGICAL_USERS: "2",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      CAMPAIGN_TYPE: "benchmark",
      PROFILE: "campaign",
      SURFACE: "k8s-direct",
      TESTID: "shared-benchmark",
      TOTAL_JOBS: "100",
    });
    const kueueConfig = resolveRunConfig({
      LOGICAL_USERS: "2",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      CAMPAIGN_TYPE: "benchmark",
      PROFILE: "campaign",
      SURFACE: "k8s-kueue",
      TESTID: "shared-benchmark",
      TOTAL_JOBS: "100",
    });
    const runtime = await import("../src/perfpulse");

    runtime.default(directConfig);
    runtime.default(kueueConfig);

    const createdNames = httpRequests
      .filter((request) => request.options?.tags?.name === "k8s_create_job")
      .map((request) => JSON.parse(request.body ?? "{}").metadata.name);
    expect(createdNames).toEqual([
      "perfpulse-shared-benchmark-direct-75",
      "perfpulse-shared-benchmark-kueue-75",
    ]);
    expect(JSON.stringify(metricRecords)).not.toContain("perfpulse-shared-benchmark-direct-75");
    expect(JSON.stringify(metricRecords)).not.toContain("perfpulse-shared-benchmark-kueue-75");
  });

  test("runs the Skaha surface with runtime API URL and bearer-token auth", async () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      PROFILE: "cron",
      SKAHA_API_URL: "https://ws.example/skaha/v1",
      SURFACE: "skaha",
      TESTID: "skaha-spot",
    });
    const runtime = await import("../src/perfpulse");

    const setupData = runtime.setup();
    runtime.default(setupData);

    const loginRequest = httpRequests.find(
      (request) => request.options?.tags?.name === "skaha_login",
    );
    const loginBody = new URLSearchParams(loginRequest?.body ?? "");
    expect(loginRequest?.url).toBe("https://ws-cadc.canfar.net/ac/login");
    expect(loginBody.get("username")).toBe("runtime-user");
    expect(loginBody.get("password")).toBe(" runtime-password ");

    const createRequest = httpRequests.find(
      (request) => request.options?.tags?.name === "skaha_create_session",
    );
    const url = new URL(String(createRequest?.url));
    expect(url.origin + url.pathname).toBe("https://ws.example/skaha/v1/session");
    expect(url.searchParams.get("name")).toBe("perfpulse-skaha-spot-skaha-0");
    expect(url.searchParams.get("image")).toBe("images.canfar.net/skaha/stress-ng:latest");
    expect(url.searchParams.get("type")).toBe("headless");
    expect(url.searchParams.get("cmd")).toBe("stress-ng");
    expect(url.searchParams.get("args")).toBe("--cpu 1 --timeout 10s --metrics-brief");
    expect(url.searchParams.getAll("env")).toEqual(["PERF_PULSE_TESTID=skaha-spot"]);
    expect(createRequest?.options).toMatchObject({
      headers: {
        Authorization: "Bearer runtime-token",
        "X-Skaha-Authentication-Type": "RUNTIME-TOKEN",
      },
      tags: { name: "skaha_create_session", ...metricTags(config) },
    });
    expect(metricRecords).toContainEqual({
      metric: METRIC_NAMES.jobsSubmitted,
      tags: expect.objectContaining({
        surface: "skaha",
        testid: "skaha-spot",
      }),
      value: 1,
    });
    expect(metricRecords).not.toContainEqual(
      expect.objectContaining({
        metric: METRIC_NAMES.jobsCompletionFailed,
        value: 1,
      }),
    );
  });

  test("derives Skaha registry auth from mounted credentials without surfacing the secret", async () => {
    const runtime = await import("../src/perfpulse");

    const setupData = runtime.setup();
    runtime.default(setupData);

    const registryAuth = Buffer.from("runtime-user: runtime-password ", "utf8").toString("base64");
    const skahaRequests = httpRequests.filter((request) =>
      request.options?.tags?.name?.startsWith("skaha_"),
    );
    expect(skahaRequests.map((request) => request.options?.headers)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ "X-Skaha-Registry-Auth": registryAuth }),
        expect.objectContaining({ "X-Skaha-Registry-Auth": registryAuth }),
        expect.objectContaining({ "X-Skaha-Registry-Auth": registryAuth }),
      ]),
    );
    expect(JSON.stringify(metricRecords)).not.toContain("runtime-password");
    expect(JSON.stringify(setupData.config)).not.toContain("runtime-password");
  });

  test("uses the k6 global iteration index for Skaha session identity", async () => {
    iterationInTest = 75;
    const config = resolveRunConfig({
      LOGICAL_USERS: "2",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      CAMPAIGN_TYPE: "benchmark",
      PROFILE: "campaign",
      SKAHA_API_URL: "https://ws.example/skaha/v1",
      SURFACE: "skaha",
      TESTID: "skaha-benchmark",
      TOTAL_JOBS: "100",
    });
    const runtime = await import("../src/perfpulse");

    runtime.default({ config, skahaBearerToken: "runtime-token" });

    const createRequest = httpRequests.find(
      (request) => request.options?.tags?.name === "skaha_create_session",
    );
    const url = new URL(String(createRequest?.url));
    expect(url.searchParams.get("name")).toBe("perfpulse-skaha-benchmark-skaha-75");
    expect(url.searchParams.getAll("env")).toEqual(["PERF_PULSE_TESTID=skaha-benchmark"]);
    expect(JSON.stringify(metricRecords)).not.toContain("perfpulse-skaha-benchmark-skaha-75");
  });

  test("records stress Skaha visibility without hard-failing running sessions", async () => {
    sessionStatus = "Running";
    const config = resolveRunConfig({
      COMPLETION_GATE_SECONDS: "1",
      CONFIRM_STRESS: "true",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      POLL_INTERVAL_SECONDS: "1",
      CAMPAIGN_TYPE: "stress",
      CONFIRM_HIGH_USERS: "true",
      LOGICAL_USERS: "100",
      PROFILE: "campaign",
      TOTAL_JOBS: "10000",
      SKAHA_API_URL: "https://ws.example/skaha/v1",
      SURFACE: "skaha",
      TESTID: "stress-skaha",
    });
    const runtime = await import("../src/perfpulse");

    expect(() => runtime.default({ config, skahaBearerToken: "runtime-token" })).not.toThrow();

    expect(metricRecords).toContainEqual({
      metric: METRIC_NAMES.jobsSubmitted,
      tags: expect.objectContaining({ surface: "skaha", testid: "stress-skaha" }),
      value: 1,
    });
    expect(metricRecords).toContainEqual({
      metric: METRIC_NAMES.jobsVisible,
      tags: expect.objectContaining({ surface: "skaha", testid: "stress-skaha" }),
      value: 1,
    });
    expect(metricRecords).not.toContainEqual(
      expect.objectContaining({
        metric: METRIC_NAMES.jobsCompletionFailed,
        value: 1,
      }),
    );
  });

  test("applies deterministic Skaha submission stagger before session create", async () => {
    iterationInTest = 3;
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      CAMPAIGN_TYPE: "benchmark",
      CONFIRM_HIGH_USERS: "true",
      LOGICAL_USERS: "100",
      PROFILE: "campaign",
      SKAHA_API_URL: "https://ws.example/skaha/v1",
      SUBMISSION_STAGGER_SECONDS: "60",
      SURFACE: "skaha",
      TESTID: "skaha-benchmark",
      TOTAL_JOBS: "100",
    });
    const runtime = await import("../src/perfpulse");

    runtime.default({ config, skahaBearerToken: "runtime-token" });

    const createIndex = httpRequests.findIndex(
      (request) => request.options?.tags?.name === "skaha_create_session",
    );
    expect(createIndex).toBeGreaterThanOrEqual(0);
    expect(sleepCalls).toEqual([180]);
    expect(runtimeEvents).toEqual(["sleep", "skaha_create_session"]);
  });

  test("ignores Skaha submission stagger on direct and Kueue runtime paths", async () => {
    iterationInTest = 3;
    const directConfig = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      CAMPAIGN_TYPE: "benchmark",
      CONFIRM_HIGH_USERS: "true",
      LOGICAL_USERS: "100",
      PROFILE: "campaign",
      SUBMISSION_STAGGER_SECONDS: "60",
      SURFACE: "k8s-direct",
      TESTID: "direct-benchmark",
      TOTAL_JOBS: "100",
    });
    const kueueConfig = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      CAMPAIGN_TYPE: "benchmark",
      CONFIRM_HIGH_USERS: "true",
      LOGICAL_USERS: "100",
      PROFILE: "campaign",
      SUBMISSION_STAGGER_SECONDS: "60",
      SURFACE: "k8s-kueue",
      TESTID: "kueue-benchmark",
      TOTAL_JOBS: "100",
    });
    const runtime = await import("../src/perfpulse");

    runtime.default(directConfig);
    runtime.default(kueueConfig);

    expect(sleepCalls).toEqual([]);
  });

  test("cleans up a Skaha session in the same k6 iteration that created it", async () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      PROFILE: "cron",
      SKAHA_API_URL: "https://ws.example/skaha/v1",
      SURFACE: "skaha",
      TESTID: "skaha-spot",
    });
    const runtime = await import("../src/perfpulse");

    const setupData = runtime.setup();
    runtime.default(setupData);

    expect(httpRequests).toContainEqual(
      expect.objectContaining({
        method: "DELETE",
        options: expect.objectContaining({
          tags: { name: "skaha_delete_session", ...metricTags(config) },
        }),
        url: "https://ws.example/skaha/v1/session/session-runtime",
      }),
    );
    expect(httpRequests.some((request) => request.options?.tags?.name === "k8s_delete_job")).toBe(
      false,
    );
    expect(metricRecords).toContainEqual({
      metric: METRIC_NAMES.cleanupDeleted,
      tags: expect.objectContaining({
        surface: "skaha",
        testid: "skaha-spot",
      }),
      value: 1,
    });
  });

  test("treats a failed Skaha delete as cleaned up when follow-up get returns not found", async () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      PROFILE: "cron",
      SKAHA_API_URL: "https://ws.example/skaha/v1",
      SURFACE: "skaha",
      TESTID: "skaha-spot",
    });
    deleteStatuses.push(0);
    sessionGetStatuses.push(200, 404);
    const runtime = await import("../src/perfpulse");

    runtime.default({ config, skahaBearerToken: "runtime-token" });

    expect(
      httpRequests
        .filter((request) => request.options?.tags?.name?.startsWith("skaha_"))
        .map((request) => request.options?.tags?.name),
    ).toEqual([
      "skaha_create_session",
      "skaha_get_session",
      "skaha_delete_session",
      "skaha_get_session",
    ]);
    expect(metricRecords).toContainEqual({
      metric: METRIC_NAMES.cleanupFailed,
      tags: expect.objectContaining({ surface: "skaha", testid: "skaha-spot" }),
      value: 0,
    });
    expect(metricRecords).not.toContainEqual(
      expect.objectContaining({
        metric: METRIC_NAMES.cleanupFailed,
        value: 1,
      }),
    );
  });

  test("fails Skaha cleanup when failed delete verification still finds the session", async () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      PROFILE: "cron",
      SKAHA_API_URL: "https://ws.example/skaha/v1",
      SURFACE: "skaha",
      TESTID: "skaha-spot",
    });
    deleteStatuses.push(0);
    sessionGetStatuses.push(200, 200);
    const runtime = await import("../src/perfpulse");

    expect(() => runtime.default({ config, skahaBearerToken: "runtime-token" })).toThrow(
      "Skaha cleanup failed with HTTP 0",
    );
    expect(
      httpRequests
        .filter((request) => request.options?.tags?.name?.startsWith("skaha_"))
        .map((request) => request.options?.tags?.name),
    ).toEqual([
      "skaha_create_session",
      "skaha_get_session",
      "skaha_delete_session",
      "skaha_get_session",
    ]);
    expect(metricRecords).toContainEqual({
      metric: METRIC_NAMES.cleanupFailed,
      tags: expect.objectContaining({ surface: "skaha", testid: "skaha-spot" }),
      value: 1,
    });
  });

  test("does not rely on teardown module state for Skaha cleanup", async () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      PROFILE: "cron",
      SKAHA_API_URL: "https://ws.example/skaha/v1",
      SURFACE: "skaha",
      TESTID: "skaha-spot",
    });
    const runtime = await import("../src/perfpulse");

    runtime.teardown(config);

    expect(httpRequests).toHaveLength(0);
    expect(metricRecords).not.toContainEqual(
      expect.objectContaining({
        metric: METRIC_NAMES.cleanupFailed,
        value: 1,
      }),
    );
  });

  test("cleans up only current-surface Kubernetes Jobs with the same testid label", async () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      CAMPAIGN_TYPE: "benchmark",
      CONFIRM_HIGH_USERS: "true",
      LOGICAL_USERS: "100",
      PROFILE: "campaign",
      SURFACE: "k8s-direct",
      TESTID: "cleanup-many",
      TOTAL_JOBS: "100",
    });
    createdJobs.push(
      {
        labels: { [KUBERNETES_LABEL_KEYS.surface]: "k8s-direct" },
        name: "perfpulse-cleanup-many-direct-0",
      },
      {
        labels: { [KUBERNETES_LABEL_KEYS.surface]: "k8s-kueue" },
        name: "perfpulse-cleanup-many-kueue-0",
      },
      {
        labels: { [KUBERNETES_LABEL_KEYS.surface]: "k8s-direct" },
        name: "perfpulse-cleanup-many-direct-1",
      },
    );
    deleteStatuses.push(200, 202);
    const runtime = await import("../src/perfpulse");

    runtime.teardown(config);

    expect(
      httpRequests.some(
        (request) =>
          request.method === "GET" &&
          request.options?.tags?.name === "k8s_list_jobs" &&
          request.url.includes("labelSelector=perfpulse.opencadc.org%2Ftestid%3Dcleanup-many"),
      ),
    ).toBe(true);
    expect(
      httpRequests
        .filter((request) => request.options?.tags?.name === "k8s_delete_job")
        .map((request) => decodeURIComponent(request.url)),
    ).toEqual([
      expect.stringContaining("/perfpulse-cleanup-many-direct-0?propagationPolicy=Background"),
      expect.stringContaining("/perfpulse-cleanup-many-direct-1?propagationPolicy=Background"),
    ]);
    expect(metricRecords).toContainEqual({
      metric: METRIC_NAMES.cleanupDeleted,
      tags: expect.objectContaining({ surface: "k8s-direct", testid: "cleanup-many" }),
      value: 2,
    });
  });

  test("fails Kubernetes cleanup when any listed Job delete returns an unexpected status", async () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      CAMPAIGN_TYPE: "benchmark",
      CONFIRM_HIGH_USERS: "true",
      LOGICAL_USERS: "100",
      PROFILE: "campaign",
      SURFACE: "k8s-kueue",
      TESTID: "cleanup-failure",
      TOTAL_JOBS: "100",
    });
    createdJobs.push(
      {
        labels: { [KUBERNETES_LABEL_KEYS.surface]: "k8s-kueue" },
        name: "perfpulse-cleanup-failure-kueue-0",
      },
      {
        labels: { [KUBERNETES_LABEL_KEYS.surface]: "k8s-kueue" },
        name: "perfpulse-cleanup-failure-kueue-1",
      },
    );
    deleteStatuses.push(202, 500);
    const runtime = await import("../src/perfpulse");

    expect(() => runtime.teardown(config)).toThrow(
      "Cleanup failed for 1 Kubernetes Job(s): perfpulse-cleanup-failure-kueue-1 HTTP 500",
    );
    expect(metricRecords).toContainEqual({
      metric: METRIC_NAMES.cleanupFailed,
      tags: expect.objectContaining({ surface: "k8s-kueue", testid: "cleanup-failure" }),
      value: 1,
    });
  });

  test("records cleanup failure when Kubernetes Job listing fails", async () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      CAMPAIGN_TYPE: "benchmark",
      CONFIRM_HIGH_USERS: "true",
      LOGICAL_USERS: "100",
      PROFILE: "campaign",
      SURFACE: "k8s-direct",
      TESTID: "cleanup-list-failure",
      TOTAL_JOBS: "100",
    });
    listJobsStatus = 503;
    const runtime = await import("../src/perfpulse");

    expect(() => runtime.teardown(config)).toThrow(
      "Cleanup failed while listing Kubernetes Jobs for testid cleanup-list-failure surface k8s-direct: Kubernetes list Jobs failed with HTTP 503: list refused",
    );
    expect(metricRecords).toContainEqual({
      metric: METRIC_NAMES.cleanupFailed,
      tags: expect.objectContaining({ surface: "k8s-direct", testid: "cleanup-list-failure" }),
      value: 1,
    });
    expect(httpRequests.some((request) => request.options?.tags?.name === "k8s_delete_job")).toBe(
      false,
    );
  });
});
