import type { RunConfig } from "./config";

/**
 * OTLP deployment invariants (see charts/cron and charts/campaign configmaps):
 * - cron and campaign both set K6_OTEL_EXPORT_INTERVAL=5s
 * - one k6 runner per cron tick or benchmark release; K6_OTEL_SERVICE_NAME is set on the runner only
 * - sequential SURFACES share one OTLP writer; surface remains a metric tag for Grafana drilldown
 * - counters are not zero-seeded at startup; only recordExpected sets jobs_expected
 * - failure counters increment only on real failures via recordFailure, never speculatively
 * - k6 has no env to cap OTLP export retries; overlap prevention lives in the cron gate init container
 */
export const METRIC_NAMES = {
  cleanupDeleted: "perfpulse_cleanup_deleted",
  cleanupFailed: "perfpulse_cleanup_failed",
  completionLatencyMs: "perfpulse_completion_latency_ms",
  jobsCompleted: "perfpulse_jobs_completed",
  jobsCompletionFailed: "perfpulse_jobs_completion_failed",
  jobsExpected: "perfpulse_jobs_expected",
  jobsSubmissionFailed: "perfpulse_jobs_submission_failed",
  jobsSubmitted: "perfpulse_jobs_submitted",
  jobsVisibilityFailed: "perfpulse_jobs_visibility_failed",
  jobsVisible: "perfpulse_jobs_visible",
  kueueAdmissionLatencyMs: "perfpulse_kueue_admission_latency_ms",
  kueueWorkloadsAdmissionFailed: "perfpulse_kueue_workloads_admission_failed",
  kueueWorkloadsAdmitted: "perfpulse_kueue_workloads_admitted",
  submissionDurationMs: "perfpulse_submission_duration_ms",
  visibilityLatencyMs: "perfpulse_visibility_latency_ms",
} as const;

export const CUSTOM_COUNTERS = [
  METRIC_NAMES.jobsSubmitted,
  METRIC_NAMES.jobsSubmissionFailed,
  METRIC_NAMES.jobsVisible,
  METRIC_NAMES.jobsVisibilityFailed,
  METRIC_NAMES.jobsCompleted,
  METRIC_NAMES.jobsCompletionFailed,
  METRIC_NAMES.kueueWorkloadsAdmitted,
  METRIC_NAMES.kueueWorkloadsAdmissionFailed,
  METRIC_NAMES.cleanupDeleted,
  METRIC_NAMES.cleanupFailed,
] as const;

export const CUSTOM_GAUGES = [METRIC_NAMES.jobsExpected] as const;

export const CUSTOM_TRENDS = [
  METRIC_NAMES.submissionDurationMs,
  METRIC_NAMES.visibilityLatencyMs,
  METRIC_NAMES.completionLatencyMs,
  METRIC_NAMES.kueueAdmissionLatencyMs,
] as const;

export const ALLOWED_METRIC_TAGS = [
  "testid",
  "run_class",
  "surface",
  "scenario",
  "namespace",
  "user_shape",
] as const;

export type AllowedMetricTag = (typeof ALLOWED_METRIC_TAGS)[number];
export type MetricTags = Record<AllowedMetricTag, string>;

export function metricTags(config: RunConfig): MetricTags {
  return {
    namespace: config.kubernetes.namespace,
    run_class: config.runClass,
    scenario: config.scenario,
    surface: config.surface,
    testid: config.testid,
    user_shape: config.userShape,
  };
}
