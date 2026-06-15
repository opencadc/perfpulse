import { Counter, Gauge, Trend } from "k6/metrics";
import type { RunConfig } from "./config";
import {
  createLifecycleRecorder as createRecorder,
  type LifecycleMetrics,
  type LifecycleRecorder,
} from "./lifecycle-recorder";
import { METRIC_NAMES } from "./metrics-contract";

export type {
  LifecycleFailureStage,
  LifecycleMetric,
  LifecycleMetrics,
  LifecycleRecorder,
} from "./lifecycle-recorder";

const lifecycleMetrics: LifecycleMetrics = {
  cleanupDeleted: new Counter(METRIC_NAMES.cleanupDeleted),
  cleanupFailed: new Counter(METRIC_NAMES.cleanupFailed),
  completionLatencyMs: new Trend(METRIC_NAMES.completionLatencyMs),
  jobsCompleted: new Counter(METRIC_NAMES.jobsCompleted),
  jobsCompletionFailed: new Counter(METRIC_NAMES.jobsCompletionFailed),
  jobsExpected: new Gauge(METRIC_NAMES.jobsExpected),
  jobsSubmissionFailed: new Counter(METRIC_NAMES.jobsSubmissionFailed),
  jobsSubmitted: new Counter(METRIC_NAMES.jobsSubmitted),
  jobsVisibilityFailed: new Counter(METRIC_NAMES.jobsVisibilityFailed),
  jobsVisible: new Counter(METRIC_NAMES.jobsVisible),
  kueueAdmissionLatencyMs: new Trend(METRIC_NAMES.kueueAdmissionLatencyMs),
  kueueWorkloadsAdmissionFailed: new Counter(METRIC_NAMES.kueueWorkloadsAdmissionFailed),
  kueueWorkloadsAdmitted: new Counter(METRIC_NAMES.kueueWorkloadsAdmitted),
  submissionDurationMs: new Trend(METRIC_NAMES.submissionDurationMs),
  visibilityLatencyMs: new Trend(METRIC_NAMES.visibilityLatencyMs),
};

export function createLifecycleRecorder(
  config: RunConfig,
  metrics: LifecycleMetrics = lifecycleMetrics,
): LifecycleRecorder {
  return createRecorder(config, metrics);
}
