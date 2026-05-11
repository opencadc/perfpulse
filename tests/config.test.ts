import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SKAHA_API_URL,
  DEFAULT_SKAHA_WORKLOAD_IMAGE,
  DEFAULT_WORKLOAD_IMAGE,
  deriveRunConfigForJob,
  makeJobName,
  resolveRunConfig,
  sanitizeDnsLabel,
  sanitizeLabelValue,
} from "../src/config";
import { metricTags } from "../src/metrics-contract";

const EXPECTED_DEFAULT_SKAHA_API_URL =
  "http://canfar-skaha-staging-skaha-tomcat-svc.canfar-system-staging.svc.keel-prod.local:8080/skaha/v1";

describe("resolveRunConfig", () => {
  test("defaults to local no-op mode for M0", () => {
    const config = resolveRunConfig({});

    expect(config.clientMode).toBe("noop");
    expect(config.profile).toBe("cron");
    expect(config.runClass).toBe("cron");
    expect(config.campaignType).toBeUndefined();
    expect(config.surface).toBe("k8s-direct");
    expect(config.testid).toBe("local-noop");
    expect(config.jobName).toBe("perfpulse-local-noop-direct-0");
  });

  test("resolves the M0.5 kind Kubernetes path", () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      TESTID: "Kind Smoke 01",
      WORKLOAD_NAMESPACE: "canfar-workloads",
    });

    expect(config.clientMode).toBe("kubernetes");
    expect(config.testid).toBe("kind-smoke-01");
    expect(config.kubernetes.namespace).toBe("canfar-workloads");
    expect(config.jobName).toBe("perfpulse-kind-smoke-01-direct-0");
    expect(config.workload.durationSeconds).toBe(10);
    expect(config.workload.image).toBe(DEFAULT_WORKLOAD_IMAGE);
    expect(config.workload.command).toEqual(["stress-ng"]);
    expect(config.workload.args).toEqual(["--cpu", "1", "--timeout", "10s", "--metrics-brief"]);
  });

  test("resolves explicit benchmark campaigns without changing the default client mode", () => {
    const config = resolveRunConfig({
      CAMPAIGN_TYPE: "benchmark",
      LOGICAL_USERS: "1",
      PROFILE: "campaign",
      TOTAL_JOBS: "100",
    });

    expect(config.clientMode).toBe("noop");
    expect(config.profile).toBe("campaign");
    expect(config.runClass).toBe("campaign");
    expect(config.campaignType).toBe("benchmark");
    expect(config.surfaces).toEqual(["k8s-kueue", "k8s-direct", "skaha"]);
    expect(config.surface).toBe("k8s-kueue");
    expect(config.scenario).toBe("single-bulk-user");
    expect(config.jobProfile).toBe("small");
    expect(config.jobsPerSurface).toBe(100);
    expect(config.totalJobs).toBe(100);
    expect(config.logicalUsers).toBe(1);
    expect(config.userShape).toBe("1x100");
    expect(config.workload.durationSeconds).toBe(30);
  });

  test("resolves the runtime taxonomy through public configuration", () => {
    const profileInputs = [
      { env: { PROFILE: "cron" }, jobs: 1, runClass: "cron", surfaces: ["k8s-direct"] },
      {
        campaignType: "benchmark",
        env: {
          CAMPAIGN_TYPE: "benchmark",
          CONFIRM_HIGH_USERS: "true",
          LOGICAL_USERS: "100",
          PROFILE: "campaign",
          TOTAL_JOBS: "1000",
        },
        jobs: 1000,
        runClass: "campaign",
        surfaces: ["k8s-kueue", "k8s-direct", "skaha"],
      },
      {
        campaignType: "stress",
        env: {
          CAMPAIGN_TYPE: "stress",
          CONFIRM_HIGH_USERS: "true",
          CONFIRM_STRESS: "true",
          LOGICAL_USERS: "100",
          PROFILE: "campaign",
          TOTAL_JOBS: "10000",
        },
        jobs: 10000,
        runClass: "campaign",
        surfaces: ["k8s-kueue", "k8s-direct", "skaha"],
      },
    ] as const;

    for (const input of profileInputs) {
      const config = resolveRunConfig(input.env);

      expect(config.runClass).toBe(input.runClass);
      expect(config.campaignType).toBe("campaignType" in input ? input.campaignType : undefined);
      expect(config.surfaces).toEqual([...input.surfaces]);
      expect(config.jobsPerSurface).toBe(input.jobs);
    }
  });

  test("rejects stress campaigns unless the operator confirms the campaign", () => {
    expect(() =>
      resolveRunConfig({
        CAMPAIGN_TYPE: "stress",
        LOGICAL_USERS: "100",
        PROFILE: "campaign",
        TOTAL_JOBS: "10000",
      }),
    ).toThrow("Stress campaigns require CONFIRM_STRESS=true before workloads are created");
  });

  test("rejects campaigns without explicit total jobs and logical users", () => {
    expect(() => resolveRunConfig({ CAMPAIGN_TYPE: "benchmark", PROFILE: "campaign" })).toThrow(
      "Campaign runs require TOTAL_JOBS and LOGICAL_USERS",
    );
  });

  test("enforces campaign safety gates before work is created", () => {
    expect(() =>
      resolveRunConfig({
        CAMPAIGN_TYPE: "benchmark",
        LOGICAL_USERS: "26",
        PROFILE: "campaign",
        TOTAL_JOBS: "260",
      }),
    ).toThrow("Campaigns with more than 25 logical users require CONFIRM_HIGH_USERS=true");
    expect(() =>
      resolveRunConfig({
        CAMPAIGN_TYPE: "benchmark",
        CONFIRM_HIGH_USERS: "true",
        LOGICAL_USERS: "26",
        PROFILE: "campaign",
        TOTAL_JOBS: "260",
      }),
    ).not.toThrow();
    expect(() =>
      resolveRunConfig({
        CAMPAIGN_TYPE: "benchmark",
        LOGICAL_USERS: "1",
        PROFILE: "campaign",
        TOTAL_JOBS: "10001",
      }),
    ).toThrow("Campaigns with more than 10000 jobs per surface require CAMPAIGN_TYPE=stress");
    expect(() =>
      resolveRunConfig({
        CAMPAIGN_TYPE: "stress",
        CONFIRM_STRESS: "true",
        LOGICAL_USERS: "1",
        PROFILE: "campaign",
        TOTAL_JOBS: "10001",
      }),
    ).not.toThrow();
  });

  test("accepts constrained run overrides and testid aliases", () => {
    const config = resolveRunConfig({
      JOB_PROFILE: "heavy",
      LOGICAL_USERS: "4",
      SCENARIO: "many-small-users",
      SURFACES: "k8s-direct,skaha",
      TOTAL_JOBS: "12",
      testid: "Spot Override 01",
    });

    expect(config.testid).toBe("spot-override-01");
    expect(config.surfaces).toEqual(["k8s-direct", "skaha"]);
    expect(config.surface).toBe("k8s-direct");
    expect(config.scenario).toBe("many-small-users");
    expect(config.jobProfile).toBe("heavy");
    expect(config.workload.durationSeconds).toBe(60);
    expect(config.logicalUsers).toBe(4);
    expect(config.jobsPerLogicalUser).toBe(3);
    expect(config.totalJobs).toBe(12);
    expect(config.userShape).toBe("4x3");
  });

  test("keeps no-op as a client mode only, never a surface", () => {
    expect(() => resolveRunConfig({ SURFACE: "noop" })).toThrow(
      "No-op is a client mode only; it is not a surface value",
    );
  });

  test("uses mounted username and password paths for live Skaha", () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      SURFACE: "skaha",
    });

    expect(DEFAULT_SKAHA_API_URL).toBe(EXPECTED_DEFAULT_SKAHA_API_URL);
    expect(config.skaha).toEqual({
      apiUrl: EXPECTED_DEFAULT_SKAHA_API_URL,
      loginUrl: "https://ws-cadc.canfar.net/ac/login",
      passwordPath: "/var/run/secrets/perfpulse/skaha-auth/password",
      requestTimeoutSeconds: 30,
      usernamePath: "/var/run/secrets/perfpulse/skaha-auth/username",
    });
    expect(config.workload.image).toBe(DEFAULT_SKAHA_WORKLOAD_IMAGE);
    expect(config.workload.command).toEqual(["stress-ng"]);
    expect(config.workload.args).toEqual(["--cpu", "1", "--timeout", "10s", "--metrics-brief"]);
  });

  test("uses the Skaha-allowed stress-ng image and command for all default workload surfaces", () => {
    const directConfig = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      SURFACE: "k8s-direct",
    });
    const kueueConfig = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      SURFACE: "k8s-kueue",
    });
    const skahaConfig = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      SURFACE: "skaha",
    });

    expect(directConfig.workload.image).toBe(DEFAULT_WORKLOAD_IMAGE);
    expect(kueueConfig.workload.image).toBe(DEFAULT_WORKLOAD_IMAGE);
    expect(skahaConfig.workload.image).toBe(DEFAULT_WORKLOAD_IMAGE);
    expect(directConfig.workload.command).toEqual(["stress-ng"]);
    expect(kueueConfig.workload.command).toEqual(["stress-ng"]);
    expect(skahaConfig.workload.command).toEqual(["stress-ng"]);
    expect(skahaConfig.workload.args).toEqual(directConfig.workload.args);
    expect(skahaConfig.workload.args).toEqual(kueueConfig.workload.args);
  });

  test("preserves an explicit Skaha API URL override", () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      SKAHA_API_URL: "https://ws.example/skaha/v1",
      SURFACE: "skaha",
    });

    expect(config.skaha.apiUrl).toBe("https://ws.example/skaha/v1");
  });

  test("accepts Skaha request timeout and lifecycle jitter controls", () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      POLL_JITTER_MAX_MS: "250",
      SKAHA_REQUEST_TIMEOUT_SECONDS: "120",
      SUBMISSION_JITTER_MAX_MS: "500",
      SURFACE: "skaha",
    });

    expect(config.skaha.requestTimeoutSeconds).toBe(120);
    expect(config.pollJitterMaxMs).toBe(250);
    expect(config.submissionJitterMaxMs).toBe(500);
  });

  test("rejects malformed Skaha request timeout and jitter values", () => {
    expect(() => resolveRunConfig({ SKAHA_REQUEST_TIMEOUT_SECONDS: "0" })).toThrow(
      'SKAHA_REQUEST_TIMEOUT_SECONDS must be a positive integer, got "0"',
    );
    expect(() => resolveRunConfig({ SUBMISSION_JITTER_MAX_MS: "-1" })).toThrow(
      'SUBMISSION_JITTER_MAX_MS must be a non-negative integer, got "-1"',
    );
    expect(() => resolveRunConfig({ POLL_JITTER_MAX_MS: "-1" })).toThrow(
      'POLL_JITTER_MAX_MS must be a non-negative integer, got "-1"',
    );
    expect(() => resolveRunConfig({ SUBMISSION_STAGGER_SECONDS: "1" })).toThrow(
      "SUBMISSION_STAGGER_SECONDS has been replaced by SUBMISSION_JITTER_MAX_MS",
    );
  });

  test("rejects live Skaha when credential paths are explicitly empty", () => {
    expect(() =>
      resolveRunConfig({
        PERF_PULSE_CLIENT_MODE: "kubernetes",
        SKAHA_API_URL: "https://ws.example/skaha/v1",
        SKAHA_USERNAME_PATH: "",
        SURFACE: "skaha",
      }),
    ).toThrow("SKAHA_USERNAME_PATH is required when the skaha surface is selected");
  });

  test("rejects malformed workload commands", () => {
    expect(() => resolveRunConfig({ WORKLOAD_COMMAND: '{"cmd":"sleep"}' })).toThrow(
      "WORKLOAD_COMMAND must be a JSON array of strings",
    );
    expect(() => resolveRunConfig({ WORKLOAD_COMMAND: "[]" })).toThrow(
      "WORKLOAD_COMMAND must be a non-empty JSON array of strings",
    );
  });

  test("accepts explicit workload command arrays", () => {
    const config = resolveRunConfig({
      WORKLOAD_COMMAND: '["sh","-c","echo ok"]',
    });

    expect(config.workload.command).toEqual(["sh", "-c", "echo ok"]);
  });

  test("accepts explicit workload args arrays", () => {
    const config = resolveRunConfig({
      WORKLOAD_ARGS: '["--cpu","2","--timeout","5s"]',
    });

    expect(config.workload.args).toEqual(["--cpu", "2", "--timeout", "5s"]);
  });

  test("derives per-job runtime config with stable logical user buckets", () => {
    const baseConfig = resolveRunConfig({
      LOGICAL_USERS: "4",
      TESTID: "Manual Benchmark 01",
      TOTAL_JOBS: "12",
    });

    expect(deriveRunConfigForJob(baseConfig, 0)).toMatchObject({
      jobIndex: 0,
      jobName: "perfpulse-manual-benchmark-01-direct-0",
      userBucket: "bucket-0",
      userBucketIndex: 0,
    });
    expect(deriveRunConfigForJob(baseConfig, 3)).toMatchObject({
      jobIndex: 3,
      jobName: "perfpulse-manual-benchmark-01-direct-3",
      userBucket: "bucket-1",
      userBucketIndex: 1,
    });
    expect(deriveRunConfigForJob(baseConfig, 11)).toMatchObject({
      jobIndex: 11,
      jobName: "perfpulse-manual-benchmark-01-direct-11",
      userBucket: "bucket-3",
      userBucketIndex: 3,
    });
  });

  test("keeps shared testid comparable while making per-surface Job names distinct", () => {
    const directConfig = deriveRunConfigForJob(
      resolveRunConfig({
        PERF_PULSE_CLIENT_MODE: "kubernetes",
        CAMPAIGN_TYPE: "benchmark",
        CONFIRM_HIGH_USERS: "true",
        SURFACE: "k8s-direct",
        LOGICAL_USERS: "100",
        PROFILE: "campaign",
        TESTID: "Shared Benchmark 01",
        TOTAL_JOBS: "100",
      }),
      75,
    );
    const kueueConfig = deriveRunConfigForJob(
      resolveRunConfig({
        PERF_PULSE_CLIENT_MODE: "kubernetes",
        CAMPAIGN_TYPE: "benchmark",
        CONFIRM_HIGH_USERS: "true",
        LOGICAL_USERS: "100",
        PROFILE: "campaign",
        SURFACE: "k8s-kueue",
        TESTID: "Shared Benchmark 01",
        TOTAL_JOBS: "100",
      }),
      75,
    );

    expect(directConfig.testid).toBe("shared-benchmark-01");
    expect(kueueConfig.testid).toBe("shared-benchmark-01");
    expect(directConfig.jobName).toBe("perfpulse-shared-benchmark-01-direct-75");
    expect(kueueConfig.jobName).toBe("perfpulse-shared-benchmark-01-kueue-75");
    expect(directConfig.jobName).not.toBe(kueueConfig.jobName);
  });

  test("keeps per-job identity out of metric tags", () => {
    const config = deriveRunConfigForJob(
      resolveRunConfig({
        LOGICAL_USERS: "4",
        TESTID: "Metric Tags",
        TOTAL_JOBS: "12",
      }),
      7,
    );

    expect(metricTags(config)).toEqual({
      cohort: "baseline",
      job_profile: "tiny",
      namespace: "canfar-workloads",
      profile: "cron",
      run_class: "cron",
      scenario: "single-bulk-user",
      surface: "k8s-direct",
      testid: "metric-tags",
      user_shape: "4x3",
    });
  });
});

describe("Kubernetes-safe names", () => {
  test("sanitizes DNS labels and label values", () => {
    expect(sanitizeDnsLabel("PerfPulse_Run.01", "fallback")).toBe("perfpulse-run-01");
    expect(sanitizeLabelValue("PerfPulse_Run.01", "fallback")).toBe("perfpulse_run.01");
  });

  test("keeps truncated label values valid", () => {
    const value = `${"a".repeat(62)}-suffix`;

    expect(sanitizeLabelValue(value, "fallback")).toBe("a".repeat(62));
  });

  test("keeps generated Job names under the Kubernetes 63 character limit", () => {
    const name = makeJobName("a".repeat(120), "k8s-kueue", 0);

    expect(name.length).toBeLessThanOrEqual(63);
    expect(name).toStartWith("perfpulse-");
    expect(name).toEndWith("-kueue-0");
  });
});
