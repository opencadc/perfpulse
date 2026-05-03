import { describe, expect, test } from "bun:test";
import { resolveRunConfig } from "../src/config";
import {
  ALLOWED_METRIC_TAGS,
  CUSTOM_COUNTERS,
  CUSTOM_TRENDS,
  metricTags,
} from "../src/metrics-contract";

describe("metrics contract", () => {
  test("uses low-cardinality custom metric names without Prometheus suffixes", () => {
    const allCustomMetrics = [...CUSTOM_COUNTERS, ...CUSTOM_TRENDS];

    expect(allCustomMetrics).toContain("perfpulse_jobs_submitted");
    expect(allCustomMetrics.every((name) => name.startsWith("perfpulse_"))).toBe(true);
    expect(allCustomMetrics.every((name) => !name.endsWith("_total"))).toBe(true);
  });

  test("emits only approved metric tags", () => {
    const tags = metricTags(resolveRunConfig({ TESTID: "spot-20260501" }));

    expect(Object.keys(tags).sort()).toEqual([...ALLOWED_METRIC_TAGS].sort());
    expect(tags.testid).toBe("spot-20260501");
    expect(tags.surface).toBe("k8s-direct");
  });
});
