import type { LifecycleMetrics } from "../../src/lifecycle-recorder";
import { METRIC_NAMES } from "../../src/metrics-contract";

export interface MetricCall {
  tags?: Record<string, string> | undefined;
  value: number;
}

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

export function createLifecycleMetricSpies(): {
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
