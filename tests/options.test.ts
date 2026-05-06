import { describe, expect, test } from "bun:test";
import { resolveRunConfig } from "../src/config";
import { createOptions } from "../src/options";

describe("k6 options contract", () => {
  test("runs the Kind smoke as exactly one bounded shared-iterations workload", () => {
    const options = createOptions(
      resolveRunConfig({
        COMPLETION_GATE_SECONDS: "120",
        VISIBILITY_GATE_SECONDS: "60",
      }),
    );
    const scenario = options.scenarios?.spot_direct_tiny;

    expect(scenario).toMatchObject({
      executor: "shared-iterations",
      gracefulStop: "30s",
      iterations: 1,
      maxDuration: "240s",
      vus: 1,
    });
  });

  test("keeps failure thresholds focused on the M0.5 gates", () => {
    const options = createOptions(resolveRunConfig({}));

    expect(Object.keys(options.thresholds ?? {}).sort()).toEqual([
      "checks",
      "http_req_failed",
      "perfpulse_cleanup_failed",
      "perfpulse_jobs_completion_failed",
      "perfpulse_jobs_submission_failed",
      "perfpulse_jobs_visibility_failed",
    ]);
  });

  test("does not add benchmark latency or completion gates before baselines exist", () => {
    const options = createOptions(resolveRunConfig({ PROFILE: "benchmark-small" }));

    expect(Object.keys(options.thresholds ?? {}).sort()).toEqual([
      "checks",
      "http_req_failed",
      "perfpulse_cleanup_failed",
      "perfpulse_jobs_submission_failed",
    ]);
  });

  test("uses an arrival-rate executor for throughput stress profiles", () => {
    const options = createOptions(
      resolveRunConfig({ CONFIRM_STRESS: "true", PROFILE: "stress-medium" }),
    );
    const scenario = options.scenarios?.stress_medium;

    expect(scenario).toMatchObject({
      executor: "constant-arrival-rate",
      preAllocatedVUs: 100,
      timeUnit: "1s",
    });
  });

  test("keeps stress thresholds limited to safety failures", () => {
    const options = createOptions(
      resolveRunConfig({ CONFIRM_STRESS: "true", PROFILE: "stress-medium" }),
    );

    expect(Object.keys(options.thresholds ?? {}).sort()).toEqual(["perfpulse_cleanup_failed"]);
  });

  test("keeps k6 system tags low-cardinality", () => {
    const options = createOptions(resolveRunConfig({}));

    expect(options.systemTags).toEqual(["status", "method", "name", "scenario", "group", "check"]);
  });

  test("adds low-cardinality run tags to built-in k6 metrics", () => {
    const options = createOptions(
      resolveRunConfig({
        LOGICAL_USERS: "100",
        PROFILE: "benchmark-small",
        SCENARIO: "many-small-users",
        SURFACE: "k8s-kueue",
        TESTID: "Benchmark Small Manual",
        TOTAL_JOBS: "100",
      }),
    );

    expect(options.tags).toEqual({
      cohort: "baseline",
      job_profile: "small",
      namespace: "canfar-workloads",
      profile: "benchmark-small",
      run_class: "benchmark",
      scenario: "many-small-users",
      surface: "k8s-kueue",
      testid: "benchmark-small-manual",
      user_shape: "100x1",
    });
  });

  test("does not configure TLS client certificates for Skaha bearer-token auth", () => {
    const options = createOptions(
      resolveRunConfig({
        PERF_PULSE_CLIENT_MODE: "kubernetes",
        SKAHA_API_URL: "https://ws.example/skaha/v1",
        SKAHA_PASSWORD_PATH: "/mnt/skaha/password",
        SKAHA_USERNAME_PATH: "/mnt/skaha/username",
        SURFACE: "skaha",
      }),
    );

    expect(options.tlsAuth).toBeUndefined();
  });
});
