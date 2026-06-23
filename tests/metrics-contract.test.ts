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

  test("uses run class as the benchmark metric dimension", () => {
    const cronTags = metricTags(resolveRunConfig({}));
    const benchmarkTags = metricTags(
      resolveRunConfig({
        LOGICAL_USERS: "10",
        RUN_CLASS: "benchmark",
        TOTAL_JOBS: "100",
      }),
    );

    expect(cronTags).not.toHaveProperty("campaign_type");
    expect(benchmarkTags).toMatchObject({
      run_class: "benchmark",
    });
    expect(benchmarkTags).not.toHaveProperty("campaign_type");
    expect(benchmarkTags).not.toHaveProperty("profile");
  });
});
