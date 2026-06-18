import { beforeEach, describe, expect, test } from "bun:test";
import { resolveRunConfig } from "../src/config";
import { KUBERNETES_LABEL_KEYS } from "../src/labels";
import { METRIC_NAMES, metricTags } from "../src/metrics-contract";
import {
  createdJobs,
  httpRequests,
  metricRecords,
  resetK6RuntimeHarness,
  runtimeEvents,
  runtimeHarness,
  sleepCalls,
} from "./helpers/k6-runtime-harness";

describe("PerfPulse k6 runtime dispatch", () => {
  beforeEach(() => {
    resetK6RuntimeHarness();
  });

  test("records campaign jobsExpected once in setup, not per iteration", async () => {
    const campaignEnv = {
      CAMPAIGN_TYPE: "benchmark",
      CONFIRM_HIGH_USERS: "true",
      LOGICAL_USERS: "2",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      PROFILE: "campaign",
      SURFACE: "k8s-direct",
      TESTID: "campaign-expected",
      TOTAL_JOBS: "100",
    };
    const config = resolveRunConfig(campaignEnv);
    const runtime = await import("../src/perfpulse");
    const savedEnv = { ...Reflect.get(globalThis, "__ENV") };

    Reflect.set(globalThis, "__ENV", campaignEnv);
    runtime.setup();

    expect(metricRecords.filter((record) => record.metric === METRIC_NAMES.jobsExpected)).toEqual([
      {
        metric: METRIC_NAMES.jobsExpected,
        tags: expect.objectContaining({ surface: "k8s-direct", testid: "campaign-expected" }),
        value: 100,
      },
    ]);

    metricRecords.length = 0;

    for (const iteration of [0, 1, 2]) {
      runtimeHarness.iterationInTest = iteration;
      runtime.default(config);
    }

    expect(metricRecords.filter((record) => record.metric === METRIC_NAMES.jobsExpected)).toEqual(
      [],
    );

    Reflect.set(globalThis, "__ENV", savedEnv);
  });

  test("records cron jobsExpected per iteration in default, not in setup", async () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      PROFILE: "cron",
      SURFACE: "k8s-kueue",
      TESTID: "cron-expected",
    });
    const runtime = await import("../src/perfpulse");

    runtime.setup();
    runtimeHarness.iterationInTest = 0;
    runtime.default(config);

    const expectedRecords = metricRecords.filter(
      (record) => record.metric === METRIC_NAMES.jobsExpected,
    );
    expect(expectedRecords).toEqual([
      {
        metric: METRIC_NAMES.jobsExpected,
        tags: expect.objectContaining({ surface: "k8s-kueue", testid: "cron-expected" }),
        value: 1,
      },
    ]);
  });

  test("runs cron check surfaces sequentially in one iteration", async () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      PROFILE: "cron",
      SURFACES: "k8s-direct,k8s-kueue",
      TESTID: "cron-multi",
    });
    const runtime = await import("../src/perfpulse");

    runtime.default(config);

    const createRequests = httpRequests.filter(
      (request) => request.options?.tags?.name === "k8s_create_job",
    );
    expect(createRequests).toHaveLength(2);
    const createdNames = createRequests.map(
      (request) => JSON.parse(request.body ?? "{}").metadata.name,
    );
    expect(createdNames).toEqual(["perfpulse-cron-multi-direct-0", "perfpulse-cron-multi-kueue-0"]);
    expect(
      metricRecords.filter((record) => record.metric === METRIC_NAMES.jobsExpected),
    ).toHaveLength(2);
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
    expect(sleepCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("records stress Kueue visibility without hard-failing non-admission", async () => {
    runtimeHarness.jobConditionType = "Failed";
    runtimeHarness.workloadAdmitted = false;
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
    expect(metricRecords).not.toContainEqual(
      expect.objectContaining({
        metric: METRIC_NAMES.jobsCompletionFailed,
        tags: expect.objectContaining({ surface: "k8s-kueue", testid: "stress-kueue" }),
        value: 1,
      }),
    );
  });

  test("uses the k6 global iteration index for direct Kubernetes Job identity", async () => {
    runtimeHarness.iterationInTest = 75;
    runtimeHarness.vuIdInTest = 2;
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
      metric: METRIC_NAMES.jobsCompleted,
      tags: expect.objectContaining({ surface: "k8s-direct", testid: "direct-benchmark" }),
      value: 1,
    });
    expect(metricRecords).toContainEqual({
      metric: METRIC_NAMES.completionLatencyMs,
      tags: expect.objectContaining({ surface: "k8s-direct", testid: "direct-benchmark" }),
      value: expect.any(Number),
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
    expect(sleepCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("succeeds after direct visibility for stress without require completion", async () => {
    runtimeHarness.jobConditionType = "Failed";
    const config = resolveRunConfig({
      COMPLETION_TIMEOUT_SECONDS: "1",
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
    expect(metricRecords).not.toContainEqual({
      metric: METRIC_NAMES.jobsCompletionFailed,
      tags: expect.objectContaining({ surface: "k8s-direct", testid: "stress-direct" }),
      value: 1,
    });
  });

  test("emits direct lifecycle metrics in stage order through the runtime recorder", async () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      PROFILE: "cron",
      SURFACE: "k8s-direct",
      TESTID: "direct-ordered",
    });
    const runtime = await import("../src/perfpulse");

    runtime.default(config);

    expect(
      metricRecords
        .filter(
          (record) =>
            record.tags?.surface === "k8s-direct" && record.tags?.testid === "direct-ordered",
        )
        .map((record) => record.metric),
    ).toEqual([
      METRIC_NAMES.jobsExpected,
      METRIC_NAMES.jobsSubmitted,
      METRIC_NAMES.submissionDurationMs,
      METRIC_NAMES.jobsVisible,
      METRIC_NAMES.visibilityLatencyMs,
      METRIC_NAMES.jobsCompleted,
      METRIC_NAMES.completionLatencyMs,
      METRIC_NAMES.cleanupDeleted,
    ]);
  });

  test("passes the derived user bucket into Kueue Job identity", async () => {
    runtimeHarness.iterationInTest = 75;
    runtimeHarness.vuIdInTest = 2;
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
    expect(metricRecords).toContainEqual({
      metric: METRIC_NAMES.jobsCompleted,
      tags: expect.objectContaining({ surface: "k8s-kueue", testid: "kueue-benchmark" }),
      value: 1,
    });
    expect(metricRecords).toContainEqual({
      metric: METRIC_NAMES.completionLatencyMs,
      tags: expect.objectContaining({ surface: "k8s-kueue", testid: "kueue-benchmark" }),
      value: expect.any(Number),
    });
  });

  test("creates distinct direct and Kueue Job names for the same benchmark testid", async () => {
    runtimeHarness.iterationInTest = 75;
    runtimeHarness.vuIdInTest = 2;
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

  test("submits jobsPerLogicalUser Skaha sessions per stress iteration", async () => {
    runtimeHarness.iterationInTest = 1;
    runtimeHarness.vuIdInTest = 2;
    const config = resolveRunConfig({
      CAMPAIGN_TYPE: "stress",
      CONFIRM_STRESS: "true",
      CONFIRM_HIGH_USERS: "true",
      LOGICAL_USERS: "2",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      PROFILE: "campaign",
      SKAHA_API_URL: "https://ws.example/skaha/v1",
      SKAHA_BULK_POLL_MIN_SECONDS: "1",
      SURFACE: "skaha",
      TESTID: "stress-skaha-bulk",
      TOTAL_JOBS: "6",
    });
    const runtime = await import("../src/perfpulse");

    runtime.default({ config, skahaBearerToken: "runtime-token" });

    const createRequests = httpRequests.filter(
      (request) => request.options?.tags?.name === "skaha_create_session",
    );
    expect(createRequests).toHaveLength(3);
    const sessionNames = createRequests.map((request) =>
      new URL(String(request.url)).searchParams.get("name"),
    );
    expect(sessionNames).toEqual([
      "perfpulse-stress-skaha-bulk-skaha-3",
      "perfpulse-stress-skaha-bulk-skaha-4",
      "perfpulse-stress-skaha-bulk-skaha-5",
    ]);
  });

  test("anchors bulk Skaha stress sessions to the VU bucket, not iterationInTest", async () => {
    runtimeHarness.iterationInTest = 1;
    runtimeHarness.vuIdInTest = 1;
    const config = resolveRunConfig({
      CAMPAIGN_TYPE: "stress",
      CONFIRM_STRESS: "true",
      CONFIRM_HIGH_USERS: "true",
      LOGICAL_USERS: "2",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      PROFILE: "campaign",
      SKAHA_API_URL: "https://ws.example/skaha/v1",
      SKAHA_BULK_POLL_MIN_SECONDS: "1",
      SURFACE: "skaha",
      TESTID: "stress-skaha-bucket",
      TOTAL_JOBS: "6",
    });
    const runtime = await import("../src/perfpulse");

    runtime.default({ config, skahaBearerToken: "runtime-token" });

    const sessionNames = httpRequests
      .filter((request) => request.options?.tags?.name === "skaha_create_session")
      .map((request) => new URL(String(request.url)).searchParams.get("name"));
    expect(sessionNames).toEqual([
      "perfpulse-stress-skaha-bucket-skaha-0",
      "perfpulse-stress-skaha-bucket-skaha-1",
      "perfpulse-stress-skaha-bucket-skaha-2",
    ]);
  });

  test("submits only the remaining jobs for the final logical user bucket", async () => {
    runtimeHarness.iterationInTest = 1;
    runtimeHarness.vuIdInTest = 2;
    const config = resolveRunConfig({
      CAMPAIGN_TYPE: "stress",
      CONFIRM_STRESS: "true",
      CONFIRM_HIGH_USERS: "true",
      LOGICAL_USERS: "2",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      PROFILE: "campaign",
      SKAHA_API_URL: "https://ws.example/skaha/v1",
      SKAHA_BULK_POLL_MIN_SECONDS: "1",
      SURFACE: "skaha",
      TESTID: "stress-skaha-remainder",
      TOTAL_JOBS: "7",
    });
    const runtime = await import("../src/perfpulse");

    runtime.default({ config, skahaBearerToken: "runtime-token" });

    expect(
      httpRequests.filter((request) => request.options?.tags?.name === "skaha_create_session"),
    ).toHaveLength(3);
  });

  test("records cleanup_deleted for each terminal bulk Skaha stress session", async () => {
    runtimeHarness.iterationInTest = 0;
    runtimeHarness.vuIdInTest = 1;
    metricRecords.length = 0;
    const config = resolveRunConfig({
      CAMPAIGN_TYPE: "stress",
      CONFIRM_STRESS: "true",
      CONFIRM_HIGH_USERS: "true",
      LOGICAL_USERS: "1",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      PROFILE: "campaign",
      SKAHA_API_URL: "https://ws.example/skaha/v1",
      SKAHA_BULK_POLL_MIN_SECONDS: "1",
      SURFACE: "skaha",
      TESTID: "stress-skaha-cleanup",
      TOTAL_JOBS: "3",
    });
    const runtime = await import("../src/perfpulse");

    runtime.default({ config, skahaBearerToken: "runtime-token" });

    expect(
      metricRecords.filter(
        (record) =>
          record.metric === METRIC_NAMES.cleanupDeleted &&
          record.tags?.testid === "stress-skaha-cleanup",
      ),
    ).toEqual([
      {
        metric: METRIC_NAMES.cleanupDeleted,
        tags: expect.objectContaining({ surface: "skaha", testid: "stress-skaha-cleanup" }),
        value: 1,
      },
      {
        metric: METRIC_NAMES.cleanupDeleted,
        tags: expect.objectContaining({ surface: "skaha", testid: "stress-skaha-cleanup" }),
        value: 1,
      },
      {
        metric: METRIC_NAMES.cleanupDeleted,
        tags: expect.objectContaining({ surface: "skaha", testid: "stress-skaha-cleanup" }),
        value: 1,
      },
    ]);
  });

  test("records campaign jobsExpected as totalJobs for Skaha stress in setup", async () => {
    const campaignEnv = {
      CAMPAIGN_TYPE: "stress",
      CONFIRM_STRESS: "true",
      CONFIRM_HIGH_USERS: "true",
      LOGICAL_USERS: "2",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      PROFILE: "campaign",
      SKAHA_API_URL: "https://ws.example/skaha/v1",
      SURFACE: "skaha",
      TESTID: "stress-skaha-expected",
      TOTAL_JOBS: "6",
    };
    const config = resolveRunConfig(campaignEnv);
    const runtime = await import("../src/perfpulse");
    const savedEnv = { ...Reflect.get(globalThis, "__ENV") };

    Reflect.set(globalThis, "__ENV", campaignEnv);
    runtime.setup();

    expect(metricRecords.filter((record) => record.metric === METRIC_NAMES.jobsExpected)).toEqual([
      {
        metric: METRIC_NAMES.jobsExpected,
        tags: expect.objectContaining({ surface: "skaha", testid: "stress-skaha-expected" }),
        value: 6,
      },
    ]);

    metricRecords.length = 0;
    runtime.default({ config, skahaBearerToken: "runtime-token" });
    expect(metricRecords.filter((record) => record.metric === METRIC_NAMES.jobsExpected)).toEqual(
      [],
    );

    Reflect.set(globalThis, "__ENV", savedEnv);
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
    expect(url.searchParams.get("args")).toBe(
      "--cpu 1 --temp-path /tmp --timeout 60s --metrics-brief",
    );
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
    expect(metricRecords).toContainEqual({
      metric: METRIC_NAMES.jobsCompleted,
      tags: expect.objectContaining({
        surface: "skaha",
        testid: "skaha-spot",
      }),
      value: 1,
    });
    expect(metricRecords).toContainEqual({
      metric: METRIC_NAMES.completionLatencyMs,
      tags: expect.objectContaining({
        surface: "skaha",
        testid: "skaha-spot",
      }),
      value: expect.any(Number),
    });
    expect(metricRecords).not.toContainEqual(
      expect.objectContaining({
        metric: METRIC_NAMES.jobsCompletionFailed,
        value: 1,
      }),
    );
    expect(runtimeHarness.checkCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checks: expect.objectContaining({
            "skaha login returned 2xx": true,
          }),
        }),
        expect.objectContaining({
          checks: expect.objectContaining({
            "skaha session create returned 2xx": true,
          }),
        }),
      ]),
    );
    expect(runtimeHarness.groupCalls).toEqual(
      expect.arrayContaining(["work_lifecycle", "work_submit", "work_visible"]),
    );
    expect(runtimeHarness.groupCalls).not.toContain("work_complete");
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
    runtimeHarness.iterationInTest = 75;
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

  test("succeeds after Skaha visibility for stress without require completion", async () => {
    runtimeHarness.sessionStatus = "Failed";
    const config = resolveRunConfig({
      COMPLETION_TIMEOUT_SECONDS: "1",
      CONFIRM_STRESS: "true",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      POLL_INTERVAL_SECONDS: "1",
      CAMPAIGN_TYPE: "stress",
      CONFIRM_HIGH_USERS: "true",
      LOGICAL_USERS: "2",
      PROFILE: "campaign",
      SKAHA_API_URL: "https://ws.example/skaha/v1",
      SKAHA_BULK_POLL_MIN_SECONDS: "1",
      SURFACE: "skaha",
      TESTID: "stress-skaha",
      TOTAL_JOBS: "6",
    });
    const runtime = await import("../src/perfpulse");

    expect(() => runtime.default({ config, skahaBearerToken: "runtime-token" })).not.toThrow();

    expect(
      metricRecords.filter(
        (record) =>
          record.metric === METRIC_NAMES.jobsSubmitted && record.tags?.testid === "stress-skaha",
      ),
    ).toHaveLength(3);
    expect(
      metricRecords.filter(
        (record) =>
          record.metric === METRIC_NAMES.jobsVisible && record.tags?.testid === "stress-skaha",
      ),
    ).toHaveLength(0);
    expect(
      metricRecords.filter(
        (record) =>
          record.metric === METRIC_NAMES.jobsCompletionFailed &&
          record.tags?.testid === "stress-skaha",
      ),
    ).toHaveLength(3);
  });

  test("applies submission jitter before session create", async () => {
    runtimeHarness.iterationInTest = 3;
    const originalRandom = Math.random;
    Math.random = () => 0.5;
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      CAMPAIGN_TYPE: "benchmark",
      CONFIRM_HIGH_USERS: "true",
      LOGICAL_USERS: "100",
      PROFILE: "campaign",
      SKAHA_API_URL: "https://ws.example/skaha/v1",
      POLL_JITTER_MAX_MS: "0",
      SUBMISSION_JITTER_MAX_MS: "1000",
      SURFACE: "skaha",
      TESTID: "skaha-benchmark",
      TOTAL_JOBS: "100",
    });
    const runtime = await import("../src/perfpulse");

    try {
      runtime.default({ config, skahaBearerToken: "runtime-token" });
    } finally {
      Math.random = originalRandom;
    }

    const createIndex = httpRequests.findIndex(
      (request) => request.options?.tags?.name === "skaha_create_session",
    );
    expect(createIndex).toBeGreaterThanOrEqual(0);
    expect(sleepCalls[0]).toBe(0.5);
    expect(runtimeEvents).toEqual(["sleep", "skaha_create_session"]);
  });

  test("applies submission jitter on direct and Kueue runtime paths", async () => {
    runtimeHarness.iterationInTest = 3;
    const originalRandom = Math.random;
    Math.random = () => 0.5;
    const directConfig = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      CAMPAIGN_TYPE: "benchmark",
      CONFIRM_HIGH_USERS: "true",
      LOGICAL_USERS: "100",
      PROFILE: "campaign",
      POLL_JITTER_MAX_MS: "0",
      SUBMISSION_JITTER_MAX_MS: "1000",
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
      POLL_JITTER_MAX_MS: "0",
      SUBMISSION_JITTER_MAX_MS: "1000",
      SURFACE: "k8s-kueue",
      TESTID: "kueue-benchmark",
      TOTAL_JOBS: "100",
    });
    const runtime = await import("../src/perfpulse");

    try {
      runtime.default(directConfig);
      runtime.default(kueueConfig);
    } finally {
      Math.random = originalRandom;
    }

    expect(sleepCalls.filter((value) => value === 0.5)).toHaveLength(2);
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
        url: "https://ws.example/skaha/v1/session/session-runtime-0",
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
    runtimeHarness.deleteStatuses.push(0);
    runtimeHarness.sessionGetStatuses.push(200, 200, 404);
    const runtime = await import("../src/perfpulse");

    runtime.default({ config, skahaBearerToken: "runtime-token" });

    expect(
      httpRequests
        .filter((request) => request.options?.tags?.name?.startsWith("skaha_"))
        .map((request) => request.options?.tags?.name),
    ).toEqual([
      "skaha_create_session",
      "skaha_get_session",
      "skaha_get_session",
      "skaha_delete_session",
      "skaha_get_session",
    ]);
    expect(metricRecords).not.toContainEqual(
      expect.objectContaining({
        metric: METRIC_NAMES.cleanupFailed,
        tags: expect.objectContaining({ surface: "skaha", testid: "skaha-spot" }),
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
    runtimeHarness.deleteStatuses.push(0);
    runtimeHarness.sessionGetStatuses.push(200, 200, 200);
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
    runtimeHarness.deleteStatuses.push(200, 202);
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

  test("preserves failed direct workloads when preserve on failure is enabled", async () => {
    runtimeHarness.listJobsReturnEmpty = true;
    const config = resolveRunConfig({
      PRESERVE_ON_FAILURE: "true",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      POLL_INTERVAL_SECONDS: "1",
      POLL_JITTER_MAX_MS: "0",
      PROFILE: "cron",
      SURFACE: "k8s-direct",
      TESTID: "preserve-direct",
      VISIBILITY_GATE_SECONDS: "1",
    });
    const runtime = await import("../src/perfpulse");

    expect(() => runtime.default(config)).toThrow(
      "Kubernetes Job perfpulse-preserve-direct-direct-0 was not visible within 1s",
    );
    expect(httpRequests.some((request) => request.method === "DELETE")).toBe(false);
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
    runtimeHarness.deleteStatuses.push(202, 500);
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
    runtimeHarness.listJobsStatus = 503;
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
