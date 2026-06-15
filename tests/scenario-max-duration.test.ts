import { describe, expect, test } from "bun:test";
import { resolveRunConfig } from "../src/config";
import {
  computeScenarioMaxDurationSeconds,
  DEFAULT_CAMPAIGN_CORE_BUDGET,
} from "../src/scenario-max-duration";

describe("computeScenarioMaxDurationSeconds", () => {
  test("keeps cron bounded to a single job lifecycle", () => {
    const config = resolveRunConfig({
      COMPLETION_TIMEOUT_SECONDS: "120",
      VISIBILITY_GATE_SECONDS: "60",
    });

    expect(computeScenarioMaxDurationSeconds(config)).toBe(600);
  });

  test("scales campaign duration by iteration waves and queue backlog", () => {
    const config = resolveRunConfig({
      CAMPAIGN_TYPE: "stress",
      CONFIRM_HIGH_USERS: "true",
      CONFIRM_STRESS: "true",
      LOGICAL_USERS: "100",
      PROFILE: "campaign",
      TOTAL_JOBS: "10000",
      VISIBILITY_GATE_SECONDS: "120",
      WORKLOAD_DURATION_SECONDS: "30",
    });

    expect(computeScenarioMaxDurationSeconds(config)).toBe(39_300);
  });

  test("respects a smaller core budget when supplied", () => {
    const config = resolveRunConfig({
      CAMPAIGN_TYPE: "benchmark",
      CONFIRM_HIGH_USERS: "true",
      LOGICAL_USERS: "5",
      PROFILE: "campaign",
      TOTAL_JOBS: "100",
      VISIBILITY_GATE_SECONDS: "120",
      WORKLOAD_DURATION_SECONDS: "60",
    });

    const duration = computeScenarioMaxDurationSeconds(config, 10);
    expect(duration).toBeGreaterThan(
      computeScenarioMaxDurationSeconds(config, DEFAULT_CAMPAIGN_CORE_BUDGET),
    );
  });

  test("extends scenario duration for Skaha submission timeouts", () => {
    const config = resolveRunConfig({
      CAMPAIGN_TYPE: "benchmark",
      LOGICAL_USERS: "1",
      PROFILE: "campaign",
      SURFACE: "skaha",
      TOTAL_JOBS: "1",
      SKAHA_REQUEST_TIMEOUT_SECONDS: "600",
    });

    expect(computeScenarioMaxDurationSeconds(config)).toBeGreaterThan(259_800);
  });
});
