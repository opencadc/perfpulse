import { check, fail, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";
import { type RunConfig, resolveRunConfig } from "./config";
import { createKubernetesClient, pollUntil } from "./kubernetes/api";
import { runDirectKubernetesSurface } from "./kubernetes/direct";
import { METRIC_NAMES, type MetricTags, metricTags } from "./metrics-contract";
import { createOptions } from "./options";

const config = resolveRunConfig(__ENV);
const serviceAccountToken =
  config.clientMode === "kubernetes" ? String(open(config.kubernetes.tokenPath)).trim() : "";

export const options = createOptions(config);

const jobsSubmitted = new Counter(METRIC_NAMES.jobsSubmitted);
const jobsSubmissionFailed = new Counter(METRIC_NAMES.jobsSubmissionFailed);
const jobsVisible = new Counter(METRIC_NAMES.jobsVisible);
const jobsVisibilityFailed = new Counter(METRIC_NAMES.jobsVisibilityFailed);
const jobsCompleted = new Counter(METRIC_NAMES.jobsCompleted);
const jobsCompletionFailed = new Counter(METRIC_NAMES.jobsCompletionFailed);
const cleanupDeleted = new Counter(METRIC_NAMES.cleanupDeleted);
const cleanupFailed = new Counter(METRIC_NAMES.cleanupFailed);
const submissionDuration = new Trend(METRIC_NAMES.submissionDurationMs);
const visibilityLatency = new Trend(METRIC_NAMES.visibilityLatencyMs);
const completionLatency = new Trend(METRIC_NAMES.completionLatencyMs);

export function setup(): RunConfig {
  console.log(
    `PerfPulse ${config.profile}: mode=${config.clientMode} surface=${config.surface} testid=${config.testid}`,
  );
  console.log(
    "Executor rationale: shared-iterations closed model because spot-direct-tiny creates one bounded workload and exits.",
  );
  return config;
}

export default function (data: RunConfig): void {
  const tags = metricTags(data);
  seedFailureCounters(tags);

  if (data.clientMode === "noop") {
    runNoop(data, tags);
    return;
  }

  runKubernetes(data, tags);
}

export function teardown(data: RunConfig): void {
  const tags = metricTags(data);
  if (data.clientMode !== "kubernetes" || !data.cleanup) {
    cleanupFailed.add(0, tags);
    return;
  }

  const client = createKubernetesClient(data, serviceAccountToken);
  const response = client.deleteJob(data.jobName);
  const cleanupOk = response.status === 200 || response.status === 202 || response.status === 404;
  check(response, {
    "cleanup delete accepted or already gone": () => cleanupOk,
  });

  if (response.status === 200 || response.status === 202) {
    cleanupDeleted.add(1, tags);
  }
  if (!cleanupOk) {
    cleanupFailed.add(1, tags);
    fail(`Cleanup failed for ${data.jobName}: HTTP ${response.status}`);
  }
}

function runNoop(data: RunConfig, tags: MetricTags): void {
  jobsSubmitted.add(1, tags);
  submissionDuration.add(1, tags);
  jobsVisible.add(1, tags);
  visibilityLatency.add(1, tags);
  jobsCompleted.add(1, tags);
  completionLatency.add(1, tags);
  cleanupDeleted.add(0, tags);
  check(true, {
    "noop workload submitted": (ok) => ok,
    "noop workload visible": (ok) => ok,
    "noop workload completed": (ok) => ok,
  });
  sleep(data.noopSleepSeconds);
}

function runKubernetes(data: RunConfig, tags: MetricTags): void {
  const client = createKubernetesClient(data, serviceAccountToken);
  const result = runDirectKubernetesSurface(data, client, pollUntil);
  submissionDuration.add(result.submissionDurationMs, tags);

  if (result.failure?.stage === "submission") {
    jobsSubmissionFailed.add(1, tags);
    fail(result.failure.message);
  }

  jobsSubmitted.add(1, tags);
  check(result.createResponse, {
    "kubernetes job create returned 201": (response) => response.status === 201,
  });

  if (result.failure?.stage === "visibility") {
    jobsVisibilityFailed.add(1, tags);
    fail(result.failure.message);
  }

  jobsVisible.add(1, tags);
  if (result.visibilityLatencyMs !== undefined) {
    visibilityLatency.add(result.visibilityLatencyMs, tags);
  }

  if (result.failure?.stage === "completion") {
    jobsCompletionFailed.add(1, tags);
    fail(result.failure.message);
  }

  jobsCompleted.add(1, tags);
  if (result.completionLatencyMs !== undefined) {
    completionLatency.add(result.completionLatencyMs, tags);
  }
}

function seedFailureCounters(tags: MetricTags): void {
  jobsSubmissionFailed.add(0, tags);
  jobsVisibilityFailed.add(0, tags);
  jobsCompletionFailed.add(0, tags);
  cleanupFailed.add(0, tags);
}
