import { describe, expect, test } from "bun:test";
import { resolveRunConfig } from "../src/config";
import {
  ALLOWED_METRIC_TAGS,
  CUSTOM_COUNTERS,
  CUSTOM_GAUGES,
  CUSTOM_TRENDS,
  metricTags,
} from "../src/metrics-contract";

describe("metrics contract", () => {
  test("uses low-cardinality custom metric names without Prometheus suffixes", () => {
    const allCustomMetrics = [...CUSTOM_COUNTERS, ...CUSTOM_GAUGES, ...CUSTOM_TRENDS];

    expect(CUSTOM_GAUGES).toContain("perfpulse_jobs_expected");
    expect(allCustomMetrics).toContain("perfpulse_jobs_submitted");
    expect(allCustomMetrics.every((name) => name.startsWith("perfpulse_"))).toBe(true);
    expect(allCustomMetrics.every((name) => !name.endsWith("_total"))).toBe(true);
  });

  test("emits only approved metric tags", () => {
    const tags = metricTags(resolveRunConfig({ TESTID: "spot-20260501" }));

    expect(
      Object.keys(tags).every((tag) => (ALLOWED_METRIC_TAGS as readonly string[]).includes(tag)),
    ).toBe(true);
    expect(tags.testid).toBe("spot-20260501");
    expect(tags.surface).toBe("k8s-direct");
  });

  test("emits low-cardinality campaign type for campaigns only", () => {
    const cronTags = metricTags(resolveRunConfig({}));
    const campaignTags = metricTags(
      resolveRunConfig({
        CAMPAIGN_TYPE: "benchmark",
        LOGICAL_USERS: "10",
        PROFILE: "campaign",
        TOTAL_JOBS: "100",
      }),
    );

    expect(cronTags).not.toHaveProperty("campaign_type");
    expect(campaignTags).toMatchObject({
      campaign_type: "benchmark",
      profile: "campaign",
      run_class: "campaign",
    });
  });
});
