import { describe, expect, test } from "bun:test";
import { makeJobName, resolveRunConfig, sanitizeDnsLabel, sanitizeLabelValue } from "../src/config";

describe("resolveRunConfig", () => {
  test("defaults to local no-op mode for M0", () => {
    const config = resolveRunConfig({});

    expect(config.clientMode).toBe("noop");
    expect(config.profile).toBe("spot-direct-tiny");
    expect(config.surface).toBe("k8s-direct");
    expect(config.testid).toBe("local-noop");
    expect(config.jobName).toBe("perfpulse-local-noop-0");
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
    expect(config.jobName).toBe("perfpulse-kind-smoke-01-0");
    expect(config.workload.durationSeconds).toBe(10);
    expect(config.workload.image).toBe("docker.io/alexeiled/stress-ng");
    expect(config.workload.command).toBeUndefined();
    expect(config.workload.args).toEqual(["--cpu", "1", "--timeout", "10s", "--metrics-brief"]);
  });

  test("resolves canned benchmark profiles without changing the default client mode", () => {
    const config = resolveRunConfig({ PROFILE: "benchmark-small" });

    expect(config.clientMode).toBe("noop");
    expect(config.profile).toBe("benchmark-small");
    expect(config.runClass).toBe("benchmark");
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

  test("resolves the PRD canned profile catalog through public configuration", () => {
    const profileInputs = [
      { env: { PROFILE: "spot-direct-tiny" }, jobs: 1, runClass: "spot", surfaces: ["k8s-direct"] },
      {
        env: { PROFILE: "spot-tiny" },
        jobs: 1,
        runClass: "spot",
        surfaces: ["k8s-direct", "k8s-kueue", "skaha"],
      },
      {
        env: { PROFILE: "benchmark-medium" },
        jobs: 1000,
        runClass: "benchmark",
        surfaces: ["k8s-kueue", "k8s-direct", "skaha"],
      },
      {
        env: { CONFIRM_STRESS: "true", PROFILE: "stress-medium" },
        jobs: 10000,
        runClass: "stress",
        surfaces: ["k8s-kueue", "k8s-direct", "skaha"],
      },
      {
        env: { CONFIRM_STRESS: "true", PROFILE: "stress-high" },
        jobs: 100000,
        runClass: "stress",
        surfaces: ["k8s-kueue"],
      },
    ] as const;

    for (const input of profileInputs) {
      const config = resolveRunConfig(input.env);

      expect(config.runClass).toBe(input.runClass);
      expect(config.surfaces).toEqual([...input.surfaces]);
      expect(config.jobsPerSurface).toBe(input.jobs);
    }
  });

  test("rejects stress profiles unless the operator confirms the campaign", () => {
    expect(() => resolveRunConfig({ PROFILE: "stress-medium" })).toThrow(
      'Profile "stress-medium" requires CONFIRM_STRESS=true before workloads are created',
    );
  });

  test("keeps stress-high on Kueue unless optional surfaces are explicitly selected", () => {
    const defaultConfig = resolveRunConfig({
      CONFIRM_STRESS: "true",
      PROFILE: "stress-high",
    });
    const explicitConfig = resolveRunConfig({
      CONFIRM_STRESS: "true",
      PROFILE: "stress-high",
      SURFACES: "k8s-direct,skaha",
    });

    expect(defaultConfig.surfaces).toEqual(["k8s-kueue"]);
    expect(defaultConfig.surface).toBe("k8s-kueue");
    expect(defaultConfig.jobsPerSurface).toBe(100000);
    expect(explicitConfig.surfaces).toEqual(["k8s-direct", "skaha"]);
    expect(explicitConfig.surface).toBe("k8s-direct");
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
    const name = makeJobName("a".repeat(120), 0);

    expect(name.length).toBeLessThanOrEqual(63);
    expect(name).toStartWith("perfpulse-");
    expect(name).toEndWith("-0");
  });
});
