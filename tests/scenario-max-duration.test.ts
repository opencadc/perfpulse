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

  test("scales campaign duration by iteration waves and queue backlog", () => {
    const config = resolveRunConfig({
      CAMPAIGN_TYPE: "stress",
      CONFIRM_HIGH_USERS: "true",
      CONFIRM_STRESS: "true",
      LOGICAL_USERS: "100",
      PROFILE: "campaign",
      TOTAL_JOBS: "10000",
      VISIBILITY_GATE_SECONDS: "120",
    });

    expect(computeScenarioMaxDurationSeconds(config)).toBe(54_300);
  });

  test("respects a smaller core budget when supplied", () => {
    const config = resolveRunConfig({
      CAMPAIGN_TYPE: "benchmark",
      CONFIRM_HIGH_USERS: "true",
      LOGICAL_USERS: "5",
      PROFILE: "campaign",
      TOTAL_JOBS: "100",
      VISIBILITY_GATE_SECONDS: "120",
    });

    const duration = computeScenarioMaxDurationSeconds(config, 10);
    expect(duration).toBeGreaterThan(
      computeScenarioMaxDurationSeconds(config, DEFAULT_CAMPAIGN_CORE_BUDGET),
    );
  });

  test("budgets bulk Skaha stress maxDuration for sequential submit and batch poll", () => {
    const bulkStress = resolveRunConfig({
      CAMPAIGN_TYPE: "stress",
      CONFIRM_HIGH_USERS: "true",
      CONFIRM_STRESS: "true",
      LOGICAL_USERS: "20",
      PROFILE: "campaign",
      SKAHA_REQUEST_TIMEOUT_SECONDS: "600",
      SURFACE: "skaha",
      TOTAL_JOBS: "10000",
    });

    expect(computeScenarioMaxDurationSeconds(bulkStress)).toBeGreaterThan(12_000);
  });

  test("uses one k6 wave for bulk Skaha stress campaigns", () => {
    const bulkStress = resolveRunConfig({
      CAMPAIGN_TYPE: "stress",
      CONFIRM_HIGH_USERS: "true",
      CONFIRM_STRESS: "true",
      LOGICAL_USERS: "20",
      PROFILE: "campaign",
      SURFACE: "skaha",
      TOTAL_JOBS: "10000",
    });

    expect(resolveCampaignExecutionShape(bulkStress).waves).toBe(1);
    expect(computeScenarioMaxDurationSeconds(bulkStress)).toBeGreaterThan(
      bulkStress.completionTimeoutSeconds + bulkStress.skaha.requestTimeoutSeconds,
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
