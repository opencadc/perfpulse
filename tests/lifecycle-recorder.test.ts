import { describe, expect, mock, test } from "bun:test";
import { resolveRunConfig } from "../src/config";
import type { LifecycleMetrics } from "../src/metrics";
import { METRIC_NAMES, metricTags } from "../src/metrics-contract";

interface MetricCall {
  tags?: Record<string, string> | undefined;
  value: number;
}

mock.module("k6/metrics", () => ({
  Counter: class Counter {
    add(): void {}
  },
  Gauge: class Gauge {
    add(): void {}
  },
  Trend: class Trend {
    add(): void {}
  },
}));

function createMetricSpy() {
  const calls: MetricCall[] = [];
  return {
    add(value: number, tags?: Record<string, string>) {
      calls.push({ tags, value });
    },
    calls,
  };
}

type MetricSpy = ReturnType<typeof createMetricSpy>;

function metricSpy(metricsByName: Record<string, MetricSpy>, name: string): MetricSpy {
  const metric = metricsByName[name];
  if (metric === undefined) {
    throw new Error(`Missing metric spy for ${name}`);
  }
  return metric;
}

function createMetrics(): {
  metrics: LifecycleMetrics;
  callsByName: Record<string, MetricCall[]>;
} {
  const entries = Object.values(METRIC_NAMES).map((name) => [name, createMetricSpy()] as const);
  const metricsByName = Object.fromEntries(entries) as Record<string, MetricSpy>;

  return {
    callsByName: Object.fromEntries(entries.map(([name, metric]) => [name, metric.calls])),
    metrics: {
      cleanupDeleted: metricSpy(metricsByName, METRIC_NAMES.cleanupDeleted),
      cleanupFailed: metricSpy(metricsByName, METRIC_NAMES.cleanupFailed),
      completionLatencyMs: metricSpy(metricsByName, METRIC_NAMES.completionLatencyMs),
      jobsCompleted: metricSpy(metricsByName, METRIC_NAMES.jobsCompleted),
      jobsCompletionFailed: metricSpy(metricsByName, METRIC_NAMES.jobsCompletionFailed),
      jobsExpected: metricSpy(metricsByName, METRIC_NAMES.jobsExpected),
      jobsSubmissionFailed: metricSpy(metricsByName, METRIC_NAMES.jobsSubmissionFailed),
      jobsSubmitted: metricSpy(metricsByName, METRIC_NAMES.jobsSubmitted),
      jobsVisibilityFailed: metricSpy(metricsByName, METRIC_NAMES.jobsVisibilityFailed),
      jobsVisible: metricSpy(metricsByName, METRIC_NAMES.jobsVisible),
      kueueAdmissionLatencyMs: metricSpy(metricsByName, METRIC_NAMES.kueueAdmissionLatencyMs),
      kueueWorkloadsAdmissionFailed: metricSpy(
        metricsByName,
        METRIC_NAMES.kueueWorkloadsAdmissionFailed,
      ),
      kueueWorkloadsAdmitted: metricSpy(metricsByName, METRIC_NAMES.kueueWorkloadsAdmitted),
      submissionDurationMs: metricSpy(metricsByName, METRIC_NAMES.submissionDurationMs),
      visibilityLatencyMs: metricSpy(metricsByName, METRIC_NAMES.visibilityLatencyMs),
    },
  };
}

describe("LifecycleRecorder", () => {
  test("records lifecycle stage metrics with contract names and tags", async () => {
    const { createLifecycleRecorder } = await import("../src/metrics");
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      SURFACE: "k8s-kueue",
      TESTID: "kueue-spot",
    });
    const { callsByName, metrics } = createMetrics();
    const recorder = createLifecycleRecorder(config, metrics);
    const tags = metricTags(config);

    recorder.recordExpected(3);
    recorder.recordSubmitted(10);
    recorder.recordVisible(20);
    recorder.recordAdmission(30);
    recorder.recordCompleted(40);
    recorder.recordCleanup(2);

    expect(callsByName[METRIC_NAMES.jobsExpected]).toEqual([{ tags, value: 3 }]);
    expect(callsByName[METRIC_NAMES.jobsSubmitted]).toEqual([{ tags, value: 1 }]);
    expect(callsByName[METRIC_NAMES.submissionDurationMs]).toEqual([{ tags, value: 10 }]);
    expect(callsByName[METRIC_NAMES.jobsVisible]).toEqual([{ tags, value: 1 }]);
    expect(callsByName[METRIC_NAMES.visibilityLatencyMs]).toEqual([{ tags, value: 20 }]);
    expect(callsByName[METRIC_NAMES.kueueWorkloadsAdmitted]).toEqual([{ tags, value: 1 }]);
    expect(callsByName[METRIC_NAMES.kueueAdmissionLatencyMs]).toEqual([{ tags, value: 30 }]);
    expect(callsByName[METRIC_NAMES.jobsCompleted]).toEqual([{ tags, value: 1 }]);
    expect(callsByName[METRIC_NAMES.completionLatencyMs]).toEqual([{ tags, value: 40 }]);
    expect(callsByName[METRIC_NAMES.cleanupDeleted]).toEqual([{ tags, value: 2 }]);
  });

  test("maps failure stages to the matching failure counters", async () => {
    const { createLifecycleRecorder } = await import("../src/metrics");
    const config = resolveRunConfig({ TESTID: "failure-spot" });
    const { callsByName, metrics } = createMetrics();
    const recorder = createLifecycleRecorder(config, metrics);
    const tags = metricTags(config);

    recorder.recordFailure("submission");
    recorder.recordFailure("visibility");
    recorder.recordFailure("admission");
    recorder.recordFailure("completion");
    recorder.recordFailure("cleanup");

    expect(callsByName[METRIC_NAMES.jobsSubmissionFailed]).toEqual([{ tags, value: 1 }]);
    expect(callsByName[METRIC_NAMES.jobsVisibilityFailed]).toEqual([{ tags, value: 1 }]);
    expect(callsByName[METRIC_NAMES.kueueWorkloadsAdmissionFailed]).toEqual([{ tags, value: 1 }]);
    expect(callsByName[METRIC_NAMES.jobsCompletionFailed]).toEqual([{ tags, value: 1 }]);
    expect(callsByName[METRIC_NAMES.cleanupFailed]).toEqual([{ tags, value: 1 }]);
  });
});
