import type { RunConfig } from "./config";

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
  "campaign_type",
  "profile",
  "surface",
  "scenario",
  "cohort",
  "job_profile",
  "namespace",
  "user_shape",
] as const;

export type AllowedMetricTag = (typeof ALLOWED_METRIC_TAGS)[number];
export type MetricTags = Partial<Record<AllowedMetricTag, string>> &
  Record<Exclude<AllowedMetricTag, "campaign_type">, string>;

export function metricTags(config: RunConfig): MetricTags {
  return {
    ...(config.campaignType === undefined ? {} : { campaign_type: config.campaignType }),
    cohort: config.cohort,
    job_profile: config.jobProfile,
    namespace: config.kubernetes.namespace,
    profile: config.profile,
    run_class: config.runClass,
    scenario: config.scenario,
    surface: config.surface,
    testid: config.testid,
    user_shape: config.userShape,
  };
}
