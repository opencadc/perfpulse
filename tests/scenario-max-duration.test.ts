import { describe, expect, test } from "bun:test";
import { resolveCampaignExecutionShape, resolveRunConfig } from "../src/config";
import {
  computeScenarioMaxDurationSeconds,
  DEFAULT_CAMPAIGN_CORE_BUDGET,
} from "../src/scenario-max-duration";

describe("computeScenarioMaxDurationSeconds", () => {
  test("keeps cron bounded to a single job lifecycle", () => {
    const config = resolveRunConfig({
      COMPLETION_TIMEOUT_SECONDS: "120",
      SURFACES: "k8s-direct",
      VISIBILITY_GATE_SECONDS: "60",
    });

    expect(computeScenarioMaxDurationSeconds(config)).toBe(600);
  });

  test("scales cron maxDuration by sequential surface count", () => {
    const config = resolveRunConfig({
      COMPLETION_TIMEOUT_SECONDS: "120",
      SEQUENTIAL_SURFACES: "true",
      SURFACES: "k8s-direct,k8s-kueue,skaha",
      VISIBILITY_GATE_SECONDS: "60",
    });

    expect(computeScenarioMaxDurationSeconds(config)).toBe(1_200);
  });

  test("scales benchmark duration by iteration waves and queue backlog", () => {
    const config = resolveRunConfig({
      CONFIRM_HIGH_USERS: "true",
      LOGICAL_USERS: "100",
      RUN_CLASS: "benchmark",
      TOTAL_JOBS: "10000",
      VISIBILITY_GATE_SECONDS: "120",
    });

    expect(computeScenarioMaxDurationSeconds(config)).toBe(162_300);
  });

  test("respects a smaller core budget when supplied", () => {
    const config = resolveRunConfig({
      CONFIRM_HIGH_USERS: "true",
      LOGICAL_USERS: "5",
      RUN_CLASS: "benchmark",
      TOTAL_JOBS: "100",
      VISIBILITY_GATE_SECONDS: "120",
    });

    const duration = computeScenarioMaxDurationSeconds(config, 10);
    expect(duration).toBeGreaterThan(
      computeScenarioMaxDurationSeconds(config, DEFAULT_CAMPAIGN_CORE_BUDGET),
    );
  });

  test("budgets Skaha benchmark maxDuration for per-job submit and visibility polling", () => {
    const skahaBenchmark = resolveRunConfig({
      CONFIRM_HIGH_USERS: "true",
      LOGICAL_USERS: "20",
      RUN_CLASS: "benchmark",
      SKAHA_REQUEST_TIMEOUT_SECONDS: "600",
      SURFACE: "skaha",
      TOTAL_JOBS: "10000",
    });

    expect(computeScenarioMaxDurationSeconds(skahaBenchmark)).toBeGreaterThan(12_000);
  });

  test("uses per-job k6 waves for Skaha benchmarks", () => {
    const skahaBenchmark = resolveRunConfig({
      CONFIRM_HIGH_USERS: "true",
      LOGICAL_USERS: "20",
      RUN_CLASS: "benchmark",
      SURFACE: "skaha",
      TOTAL_JOBS: "10000",
    });

    expect(resolveCampaignExecutionShape(skahaBenchmark).waves).toBe(500);
    expect(computeScenarioMaxDurationSeconds(skahaBenchmark)).toBeGreaterThan(
      skahaBenchmark.skaha.requestTimeoutSeconds * 100,
    );
  });

  test("extends scenario duration for Skaha submission timeouts", () => {
    const config = resolveRunConfig({
      LOGICAL_USERS: "1",
      RUN_CLASS: "benchmark",
      SURFACE: "skaha",
      TOTAL_JOBS: "1",
      SKAHA_REQUEST_TIMEOUT_SECONDS: "600",
    });

    expect(computeScenarioMaxDurationSeconds(config)).toBeGreaterThan(259_800);
  });
});
