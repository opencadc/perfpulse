import { describe, expect, test } from "bun:test";
import { resolveRunConfig } from "../src/config";
import { createOptions } from "../src/options";

describe("k6 options contract", () => {
  test("runs the Kind smoke as exactly one bounded shared-iterations workload", () => {
    const options = createOptions(
      resolveRunConfig({
        COMPLETION_TIMEOUT_SECONDS: "120",
        VISIBILITY_GATE_SECONDS: "60",
      }),
    );
    const scenario = options.scenarios?.cron;

    expect(scenario).toMatchObject({
      executor: "shared-iterations",
      gracefulStop: "30s",
      iterations: 1,
      maxDuration: "600s",
      vus: 1,
    });
  });

  test("keeps failure thresholds focused on lifecycle gates", () => {
    const options = createOptions(resolveRunConfig({}));

    expect(Object.keys(options.thresholds ?? {}).sort()).toEqual([
      "checks",
      "http_req_duration",
      "http_req_failed",
      "perfpulse_cleanup_failed",
      "perfpulse_jobs_completion_failed",
      "perfpulse_jobs_submission_failed",
      "perfpulse_jobs_visibility_failed",
    ]);
  });

  test("uses smoke-strict HTTP and check thresholds for cron checks", () => {
    const options = createOptions(resolveRunConfig({}));

    expect(options.thresholds?.checks).toEqual(["rate==1"]);
    expect(options.thresholds?.http_req_failed).toEqual(["rate==0"]);
    expect(options.thresholds?.http_req_duration).toEqual(["p(95)<500"]);
  });

  test("does not add HTTP duration thresholds to benchmark campaigns", () => {
    const options = createOptions(
      resolveRunConfig({
        CAMPAIGN_TYPE: "benchmark",
        CONFIRM_HIGH_USERS: "true",
        LOGICAL_USERS: "100",
        PROFILE: "campaign",
        TOTAL_JOBS: "100",
      }),
    );

    expect(options.thresholds?.http_req_duration).toBeUndefined();
  });

  test("keeps benchmark campaigns on slightly relaxed HTTP and check thresholds", () => {
    const options = createOptions(
      resolveRunConfig({
        CAMPAIGN_TYPE: "benchmark",
        CONFIRM_HIGH_USERS: "true",
        LOGICAL_USERS: "100",
        PROFILE: "campaign",
        TOTAL_JOBS: "100",
      }),
    );

    expect(options.thresholds?.checks).toEqual(["rate>0.99"]);
    expect(options.thresholds?.http_req_failed).toEqual(["rate<0.01"]);
  });

  test("adds campaign completion failure gates", () => {
    const options = createOptions(
      resolveRunConfig({
        CAMPAIGN_TYPE: "benchmark",
        CONFIRM_HIGH_USERS: "true",
        LOGICAL_USERS: "100",
        PROFILE: "campaign",
        TOTAL_JOBS: "100",
      }),
    );

    expect(Object.keys(options.thresholds ?? {}).sort()).toEqual([
      "checks",
      "http_req_failed",
      "perfpulse_cleanup_failed",
      "perfpulse_jobs_completion_failed",
      "perfpulse_jobs_submission_failed",
      "perfpulse_jobs_visibility_failed",
    ]);
  });

  test("uses exact-job shared iterations for stress campaigns", () => {
    const options = createOptions(
      resolveRunConfig({
        CAMPAIGN_TYPE: "stress",
        CONFIRM_HIGH_USERS: "true",
        CONFIRM_STRESS: "true",
        LOGICAL_USERS: "100",
        PROFILE: "campaign",
        TOTAL_JOBS: "10000",
        VISIBILITY_GATE_SECONDS: "120",
      }),
    );
    const scenario = options.scenarios?.campaign;

    expect(scenario).toMatchObject({
      executor: "shared-iterations",
      iterations: 10000,
      maxDuration: "54300s",
      vus: 100,
    });
  });

  test("omits completion-failed threshold for bulk Skaha stress campaigns", () => {
    const options = createOptions(
      resolveRunConfig({
        CAMPAIGN_TYPE: "stress",
        CONFIRM_HIGH_USERS: "true",
        CONFIRM_STRESS: "true",
        LOGICAL_USERS: "20",
        PROFILE: "campaign",
        SURFACE: "skaha",
        TOTAL_JOBS: "10000",
      }),
    );

    expect(Object.keys(options.thresholds ?? {}).sort()).toEqual([
      "http_req_failed",
      "perfpulse_cleanup_failed",
      "perfpulse_jobs_submission_failed",
      "perfpulse_jobs_visibility_failed",
    ]);
  });

  test("keeps stress campaign thresholds on lifecycle failures and zero HTTP errors", () => {
    const options = createOptions(
      resolveRunConfig({
        CAMPAIGN_TYPE: "stress",
        CONFIRM_HIGH_USERS: "true",
        CONFIRM_STRESS: "true",
        LOGICAL_USERS: "100",
        PROFILE: "campaign",
        TOTAL_JOBS: "10000",
      }),
    );

    expect(Object.keys(options.thresholds ?? {}).sort()).toEqual([
      "http_req_failed",
      "perfpulse_cleanup_failed",
      "perfpulse_jobs_completion_failed",
      "perfpulse_jobs_submission_failed",
      "perfpulse_jobs_visibility_failed",
    ]);
    expect(options.thresholds?.http_req_failed).toEqual(["rate==0"]);
  });

  test("keeps k6 system tags low-cardinality", () => {
    const options = createOptions(resolveRunConfig({}));

    expect(options.systemTags).toEqual(["status", "method", "name", "scenario", "group", "check"]);
  });

  test("adds low-cardinality run tags to built-in k6 metrics", () => {
    const options = createOptions(
      resolveRunConfig({
        CAMPAIGN_TYPE: "benchmark",
        CONFIRM_HIGH_USERS: "true",
        LOGICAL_USERS: "100",
        PROFILE: "campaign",
        SCENARIO: "many-small-users",
        SURFACE: "k8s-kueue",
        TESTID: "Benchmark Small Manual",
        TOTAL_JOBS: "100",
      }),
    );

    expect(options.tags).toEqual({
      campaign_type: "benchmark",
      namespace: "canfar-workloads",
      profile: "campaign",
      run_class: "campaign",
      scenario: "many-small-users",
      surface: "k8s-kueue",
      testid: "benchmark-small-manual",
      user_shape: "100x1",
    });
  });

  test("keeps Skaha benchmark campaigns on totalJobs iterations", () => {
    const options = createOptions(
      resolveRunConfig({
        CAMPAIGN_TYPE: "benchmark",
        CONFIRM_HIGH_USERS: "true",
        LOGICAL_USERS: "100",
        PROFILE: "campaign",
        SURFACE: "skaha",
        TOTAL_JOBS: "100",
      }),
    );
    const scenario = options.scenarios?.campaign;

    expect(scenario).toMatchObject({
      executor: "shared-iterations",
      iterations: 100,
      vus: 100,
    });
  });

  test("keeps direct stress campaigns on totalJobs iterations", () => {
    const options = createOptions(
      resolveRunConfig({
        CAMPAIGN_TYPE: "stress",
        CONFIRM_HIGH_USERS: "true",
        CONFIRM_STRESS: "true",
        LOGICAL_USERS: "100",
        PROFILE: "campaign",
        SURFACE: "k8s-direct",
        TOTAL_JOBS: "10000",
      }),
    );
    const scenario = options.scenarios?.campaign;

    expect(scenario).toMatchObject({
      executor: "shared-iterations",
      iterations: 10000,
      vus: 100,
    });
  });

  test("uses logical-user shared iterations for Skaha stress campaigns", () => {
    const options = createOptions(
      resolveRunConfig({
        CAMPAIGN_TYPE: "stress",
        CONFIRM_HIGH_USERS: "true",
        CONFIRM_STRESS: "true",
        LOGICAL_USERS: "100",
        PROFILE: "campaign",
        SURFACE: "skaha",
        TOTAL_JOBS: "10000",
        VISIBILITY_GATE_SECONDS: "120",
      }),
    );
    const scenario = options.scenarios?.campaign;

    expect(scenario).toMatchObject({
      executor: "shared-iterations",
      iterations: 100,
      vus: 100,
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
