import type { RunConfig } from "./config";
import { type MetricTags, metricTags } from "./metrics-contract";

export type LifecycleFailureStage =
  | "submission"
  | "visibility"
  | "admission"
  | "completion"
  | "cleanup";

export interface LifecycleMetric {
  add(value: number, tags?: MetricTags): void;
}

export interface LifecycleMetrics {
  cleanupDeleted: LifecycleMetric;
  cleanupFailed: LifecycleMetric;
  completionLatencyMs: LifecycleMetric;
  jobsCompleted: LifecycleMetric;
  jobsCompletionFailed: LifecycleMetric;
  jobsExpected: LifecycleMetric;
  jobsSubmissionFailed: LifecycleMetric;
  jobsSubmitted: LifecycleMetric;
  jobsVisibilityFailed: LifecycleMetric;
  jobsVisible: LifecycleMetric;
  kueueAdmissionLatencyMs: LifecycleMetric;
  kueueWorkloadsAdmissionFailed: LifecycleMetric;
  kueueWorkloadsAdmitted: LifecycleMetric;
  submissionDurationMs: LifecycleMetric;
  visibilityLatencyMs: LifecycleMetric;
}

export interface LifecycleRecorder {
  recordAdmission(admissionLatencyMs?: number): void;
  recordCleanup(deletedCount: number): void;
  recordCompleted(completionLatencyMs?: number): void;
  recordExpected(expectedJobs: number): void;
  recordFailure(stage: LifecycleFailureStage): void;
  recordSubmitted(submissionDurationMs: number): void;
  recordVisible(visibilityLatencyMs?: number): void;
}

export function createLifecycleRecorder(
  config: RunConfig,
  metrics: LifecycleMetrics,
): LifecycleRecorder {
  const tags = metricTags(config);

  return {
    recordAdmission(admissionLatencyMs) {
      metrics.kueueWorkloadsAdmitted.add(1, tags);
      addIfDefined(metrics.kueueAdmissionLatencyMs, admissionLatencyMs, tags);
    },
    recordCleanup(deletedCount) {
      metrics.cleanupDeleted.add(deletedCount, tags);
    },
    recordCompleted(completionLatencyMs) {
      metrics.jobsCompleted.add(1, tags);
      addIfDefined(metrics.completionLatencyMs, completionLatencyMs, tags);
    },
    recordExpected(expectedJobs) {
      metrics.jobsExpected.add(expectedJobs, tags);
    },
    recordFailure(stage) {
      switch (stage) {
        case "submission":
          metrics.jobsSubmissionFailed.add(1, tags);
          return;
        case "visibility":
          metrics.jobsVisibilityFailed.add(1, tags);
          return;
        case "admission":
          metrics.kueueWorkloadsAdmissionFailed.add(1, tags);
          return;
        case "completion":
          metrics.jobsCompletionFailed.add(1, tags);
          return;
        case "cleanup":
          metrics.cleanupFailed.add(1, tags);
      }
    },
    recordSubmitted(submissionDurationMs) {
      metrics.jobsSubmitted.add(1, tags);
      metrics.submissionDurationMs.add(submissionDurationMs, tags);
    },
    recordVisible(visibilityLatencyMs) {
      metrics.jobsVisible.add(1, tags);
      addIfDefined(metrics.visibilityLatencyMs, visibilityLatencyMs, tags);
    },
  };
}

function addIfDefined(metric: LifecycleMetric, value: number | undefined, tags: MetricTags): void {
  if (value !== undefined) {
    metric.add(value, tags);
  }
}
