import { check, fail, sleep } from "k6";
import { b64encode } from "k6/encoding";
import * as exec from "k6/execution";
import http from "k6/http";
import { Counter, Gauge, Trend } from "k6/metrics";
import { deriveRunConfigForJob, type RunConfig, resolveRunConfig } from "./config";
import { createKubernetesClient, type KubernetesClient, pollUntil } from "./kubernetes/api";
import { runDirectKubernetesSurface } from "./kubernetes/direct";
import { runKueueKubernetesSurface } from "./kubernetes/kueue";
import type { JobLike, JobListLike } from "./kubernetes/status";
import { KUBERNETES_LABEL_KEYS } from "./labels";
import { METRIC_NAMES, type MetricTags, metricTags } from "./metrics-contract";
import { createOptions } from "./options";
import { createSkahaClient, runSkahaSurface } from "./skaha";

interface RuntimeData {
  config: RunConfig;
  skahaBearerToken?: string;
  skahaRegistryAuthHeader?: string;
}

const config = resolveRunConfig(__ENV);
const serviceAccountToken =
  config.clientMode === "kubernetes" && config.surface !== "skaha"
    ? String(open(config.kubernetes.tokenPath)).trim()
    : "";
const skahaCredentials =
  config.clientMode === "kubernetes" && config.surface === "skaha"
    ? {
        password: String(open(config.skaha.passwordPath)),
        username: String(open(config.skaha.usernamePath)).trim(),
      }
    : undefined;

export const options = createOptions(config);

const jobsSubmitted = new Counter(METRIC_NAMES.jobsSubmitted);
const jobsSubmissionFailed = new Counter(METRIC_NAMES.jobsSubmissionFailed);
const jobsExpected = new Gauge(METRIC_NAMES.jobsExpected);
const jobsVisible = new Counter(METRIC_NAMES.jobsVisible);
const jobsVisibilityFailed = new Counter(METRIC_NAMES.jobsVisibilityFailed);
const jobsCompleted = new Counter(METRIC_NAMES.jobsCompleted);
const jobsCompletionFailed = new Counter(METRIC_NAMES.jobsCompletionFailed);
const cleanupDeleted = new Counter(METRIC_NAMES.cleanupDeleted);
const cleanupFailed = new Counter(METRIC_NAMES.cleanupFailed);
const kueueWorkloadsAdmitted = new Counter(METRIC_NAMES.kueueWorkloadsAdmitted);
const kueueWorkloadsAdmissionFailed = new Counter(METRIC_NAMES.kueueWorkloadsAdmissionFailed);
const submissionDuration = new Trend(METRIC_NAMES.submissionDurationMs);
const visibilityLatency = new Trend(METRIC_NAMES.visibilityLatencyMs);
const completionLatency = new Trend(METRIC_NAMES.completionLatencyMs);
const kueueAdmissionLatency = new Trend(METRIC_NAMES.kueueAdmissionLatencyMs);

export function setup(): RuntimeData {
  console.log(
    `PerfPulse ${config.profile}: mode=${config.clientMode} surface=${config.surface} testid=${config.testid}`,
  );
  console.log(
    "Executor rationale: closed model for cron acceptance checks; campaigns select explicit workload shape.",
  );
  if (config.clientMode === "kubernetes" && config.surface === "skaha") {
    return {
      config,
      skahaBearerToken: createSkahaBearerToken(config),
      skahaRegistryAuthHeader: createSkahaRegistryAuthHeader(),
    };
  }
  return { config };
}

export default function (data: RunConfig | RuntimeData): void {
  const runtimeData = normalizeRuntimeData(data);
  const runConfig = deriveRuntimeConfig(runtimeData.config);
  const tags = metricTags(runConfig);
  seedFailureCounters(tags);
  jobsExpected.add(runConfig.totalJobs, tags);

  if (runConfig.clientMode === "noop") {
    runNoop(runConfig, tags);
    return;
  }

  runKubernetesSurface(runtimeData, runConfig, tags);
}

export function teardown(data: RunConfig | RuntimeData): void {
  const runtimeData = normalizeRuntimeData(data);
  const runConfig = runtimeData.config;
  const tags = metricTags(runConfig);
  if (!runConfig.cleanup || runConfig.clientMode !== "kubernetes") {
    cleanupFailed.add(0, tags);
    return;
  }

  if (runConfig.surface === "skaha") {
    cleanupFailed.add(0, tags);
    return;
  }

  const client = createKubernetesClient(runConfig, serviceAccountToken);
  let jobs: JobListLike;
  try {
    jobs = client.listJobsByTestId();
  } catch (error) {
    cleanupDeleted.add(0, tags);
    cleanupFailed.add(1, tags);
    fail(
      `Cleanup failed while listing Kubernetes Jobs for testid ${runConfig.testid} surface ${runConfig.surface}: ${boundedMessage(error)}`,
    );
    return;
  }
  const failures: string[] = [];
  let deletedCount = 0;

  for (const job of (jobs.items ?? []).filter((job) => isCurrentSurfaceJob(job, runConfig))) {
    const jobName = job.metadata?.name;
    if (jobName === undefined) {
      continue;
    }

    const response = client.deleteJob(jobName);
    const cleanupOk = isKubernetesCleanupOk(response.status);
    check(response, {
      "cleanup delete accepted or already gone": () => cleanupOk,
    });

    if (response.status === 200 || response.status === 202) {
      deletedCount += 1;
    }
    if (!cleanupOk) {
      failures.push(`${jobName} HTTP ${response.status}`);
    }
  }

  cleanupDeleted.add(deletedCount, tags);
  if (failures.length > 0) {
    cleanupFailed.add(1, tags);
    fail(`Cleanup failed for ${failures.length} Kubernetes Job(s): ${failures.join(", ")}`);
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

function runKubernetesSurface(runtimeData: RuntimeData, data: RunConfig, tags: MetricTags): void {
  applySubmissionJitter(data);
  switch (data.surface) {
    case "k8s-direct":
      runDirectKubernetes(data, tags);
      return;
    case "k8s-kueue":
      runKueueKubernetes(data, tags);
      return;
    case "skaha":
      runSkaha(runtimeData, data, tags);
  }
}

function runDirectKubernetes(data: RunConfig, tags: MetricTags): void {
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
    cleanupKubernetesJob(data, tags, client, data.jobName);
    fail(result.failure.message);
  }

  jobsVisible.add(1, tags);
  if (result.visibilityLatencyMs !== undefined) {
    visibilityLatency.add(result.visibilityLatencyMs, tags);
  }

  if (result.failure?.stage === "completion") {
    jobsCompletionFailed.add(1, tags);
    cleanupKubernetesJob(data, tags, client, data.jobName);
    fail(result.failure.message);
  }

  if (result.completed) {
    jobsCompleted.add(1, tags);
  }
  if (result.completed && result.completionLatencyMs !== undefined) {
    completionLatency.add(result.completionLatencyMs, tags);
  }
  cleanupKubernetesJob(data, tags, client, data.jobName);
}

function runKueueKubernetes(data: RunConfig, tags: MetricTags): void {
  const client = createKubernetesClient(data, serviceAccountToken);
  const result = runKueueKubernetesSurface(
    data,
    { ...data.kueue, userBucketIndex: data.userBucketIndex },
    client,
    pollUntil,
  );
  submissionDuration.add(result.submissionDurationMs, tags);

  if (result.failure?.stage === "submission") {
    jobsSubmissionFailed.add(1, tags);
    fail(result.failure.message);
  }

  jobsSubmitted.add(1, tags);
  check(result.createResponse, {
    "kueue job create returned 201": (response) => response.status === 201,
  });

  if (
    result.failure?.stage === "job-visibility" ||
    result.failure?.stage === "workload-visibility"
  ) {
    jobsVisibilityFailed.add(1, tags);
    cleanupKubernetesJob(data, tags, client, data.jobName);
    fail(result.failure.message);
  }

  jobsVisible.add(1, tags);
  if (result.visibilityLatencyMs !== undefined) {
    visibilityLatency.add(result.visibilityLatencyMs, tags);
  }

  if (result.failure?.stage === "admission") {
    kueueWorkloadsAdmissionFailed.add(1, tags);
    cleanupKubernetesJob(data, tags, client, data.jobName);
    fail(result.failure.message);
  }

  if (result.admitted) {
    kueueWorkloadsAdmitted.add(1, tags);
  }
  if (result.admitted && result.admissionLatencyMs !== undefined) {
    kueueAdmissionLatency.add(result.admissionLatencyMs, tags);
  }

  if (result.failure?.stage === "completion") {
    jobsCompletionFailed.add(1, tags);
    cleanupKubernetesJob(data, tags, client, data.jobName);
    fail(result.failure.message);
  }

  if (result.completed) {
    jobsCompleted.add(1, tags);
  }
  if (result.completed && result.completionLatencyMs !== undefined) {
    completionLatency.add(result.completionLatencyMs, tags);
  }
  cleanupKubernetesJob(data, tags, client, data.jobName);
}

function runSkaha(runtimeData: RuntimeData, data: RunConfig, tags: MetricTags): void {
  const client = createSkahaClient({
    apiUrl: data.skaha.apiUrl,
    http,
    registryAuthHeader: runtimeData.skahaRegistryAuthHeader,
    runConfig: data,
    token: resolveSkahaBearerToken(runtimeData, data),
  });
  const result = runSkahaSurface(
    {
      completionTimeoutSeconds: data.completionTimeoutSeconds,
      pollIntervalSeconds: data.kubernetes.pollIntervalSeconds,
      pollJitterMaxMs: data.pollJitterMaxMs,
      requireCompletion: true,
      session: {
        args: data.workload.args,
        cmd: data.workload.command?.join(" ") ?? "stress-ng",
        env: { PERF_PULSE_TESTID: data.testid },
        image: data.workload.image,
        name: data.jobName,
      },
      visibilityGateSeconds: data.visibilityGateSeconds,
    },
    client,
    pollUntil,
  );
  submissionDuration.add(result.submissionDurationMs, tags);

  if (result.failure?.stage === "submission") {
    jobsSubmissionFailed.add(1, tags);
    cleanupSkahaSession(runtimeData, data, tags, result.createResponse.sessionId);
    fail(result.failure.message);
  }

  jobsSubmitted.add(1, tags);

  if (result.failure?.stage === "visibility") {
    jobsVisibilityFailed.add(1, tags);
    cleanupSkahaSession(runtimeData, data, tags, result.createResponse.sessionId);
    fail(result.failure.message);
  }

  jobsVisible.add(1, tags);
  if (result.visibilityLatencyMs !== undefined) {
    visibilityLatency.add(result.visibilityLatencyMs, tags);
  }

  if (result.failure?.stage === "completion") {
    jobsCompletionFailed.add(1, tags);
    cleanupSkahaSession(runtimeData, data, tags, result.createResponse.sessionId);
    fail(result.failure.message);
  }

  if (result.completed) {
    jobsCompleted.add(1, tags);
  }
  if (result.completed && result.completionLatencyMs !== undefined) {
    completionLatency.add(result.completionLatencyMs, tags);
  }
  cleanupSkahaSession(runtimeData, data, tags, result.createResponse.sessionId);
}

function cleanupSkahaSession(
  runtimeData: RuntimeData,
  data: RunConfig,
  tags: MetricTags,
  sessionId: string | undefined,
): void {
  if (!data.cleanup) {
    cleanupDeleted.add(0, tags);
    cleanupFailed.add(0, tags);
    return;
  }
  if (sessionId === undefined) {
    cleanupFailed.add(1, tags);
    return;
  }

  const client = createSkahaClient({
    apiUrl: data.skaha.apiUrl,
    http,
    registryAuthHeader: runtimeData.skahaRegistryAuthHeader,
    runConfig: data,
    token: resolveSkahaBearerToken(runtimeData, data),
  });
  const result = client.deleteSession(sessionId);
  const cleanupSucceeded =
    result.cleanupSucceeded || isSkahaSessionVerifiedGone(client.getSession(sessionId));
  check(result, {
    "skaha cleanup delete accepted or already gone": () => cleanupSucceeded,
  });

  if (result.deleted) {
    cleanupDeleted.add(1, tags);
  }
  if (!cleanupSucceeded) {
    cleanupFailed.add(1, tags);
    fail(`Skaha cleanup failed with HTTP ${result.statusCode}`);
  }
  if (!result.cleanupSucceeded) {
    cleanupFailed.add(0, tags);
  }
}

function isSkahaSessionVerifiedGone(result: { found: boolean; statusCode: number }): boolean {
  return !result.found && result.statusCode === 404;
}

function cleanupKubernetesJob(
  data: RunConfig,
  tags: MetricTags,
  client: KubernetesClient,
  jobName: string | undefined,
): void {
  if (!data.cleanup) {
    cleanupDeleted.add(0, tags);
    cleanupFailed.add(0, tags);
    return;
  }
  if (jobName === undefined) {
    cleanupFailed.add(1, tags);
    fail("Kubernetes cleanup failed without a Job name");
    return;
  }

  const response = client.deleteJob(jobName);
  const cleanupOk = isKubernetesCleanupOk(response.status);
  check(response, {
    "cleanup delete accepted or already gone": () => cleanupOk,
  });

  if (response.status === 200 || response.status === 202) {
    cleanupDeleted.add(1, tags);
  }
  if (!cleanupOk) {
    cleanupFailed.add(1, tags);
    fail(`Cleanup failed for Kubernetes Job ${jobName} with HTTP ${response.status}`);
  }
  cleanupFailed.add(0, tags);
}

function seedFailureCounters(tags: MetricTags): void {
  jobsSubmissionFailed.add(0, tags);
  jobsVisibilityFailed.add(0, tags);
  jobsCompletionFailed.add(0, tags);
  kueueWorkloadsAdmissionFailed.add(0, tags);
  cleanupFailed.add(0, tags);
}

function isKubernetesCleanupOk(status: number): boolean {
  return status === 200 || status === 202 || status === 404;
}

function isCurrentSurfaceJob(job: JobLike, data: RunConfig): boolean {
  return job.metadata?.labels?.[KUBERNETES_LABEL_KEYS.surface] === data.surface;
}

function boundedMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 300);
}

function normalizeRuntimeData(data: RunConfig | RuntimeData): RuntimeData {
  return "config" in data ? data : { config: data };
}

function createSkahaBearerToken(data: RunConfig): string {
  if (skahaCredentials === undefined) {
    fail("Skaha credentials are required");
  }
  const body = encodeFormEntries([
    ["username", skahaCredentials.username],
    ["password", skahaCredentials.password],
  ]);
  const response = http.post(data.skaha.loginUrl, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    tags: { name: "skaha_login", ...metricTags(data) },
    timeout: `${data.skaha.requestTimeoutSeconds}s`,
  });
  if (response.status < 200 || response.status >= 300) {
    fail(`Skaha login failed with HTTP ${response.status}`);
  }
  const token = normalizeSkahaLoginToken(String(response.body ?? ""));
  if (token.length === 0) {
    fail("Skaha login returned an empty bearer token");
  }
  return token;
}

function createSkahaRegistryAuthHeader(): string {
  if (skahaCredentials === undefined) {
    fail("Skaha credentials are required");
  }
  return b64encode(`${skahaCredentials.username}:${skahaCredentials.password}`);
}

function normalizeSkahaLoginToken(responseBody: string): string {
  const trimmed = responseBody.trim();
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === "string") {
      return parsed.trim();
    }
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      const token = (parsed as { access_token?: unknown; token?: unknown }).token;
      const accessToken = (parsed as { access_token?: unknown; token?: unknown }).access_token;
      if (typeof token === "string") {
        return token.trim();
      }
      if (typeof accessToken === "string") {
        return accessToken.trim();
      }
    }
  } catch {
    // Plain text token responses are valid.
  }
  return trimmed;
}

function resolveSkahaBearerToken(runtimeData: RuntimeData, data: RunConfig): string {
  if (data.clientMode !== "kubernetes" || data.surface !== "skaha") {
    return "";
  }
  if (runtimeData.skahaBearerToken !== undefined) {
    return runtimeData.skahaBearerToken;
  }
  return "";
}

function encodeFormEntries(entries: Array<readonly [string, string]>): string {
  return entries
    .map(([key, value]) => `${encodeFormComponent(key)}=${encodeFormComponent(value)}`)
    .join("&");
}

function encodeFormComponent(value: string): string {
  return encodeURIComponent(value).replace(/%20/gu, "+");
}

function applySubmissionJitter(data: RunConfig): void {
  if (data.submissionJitterMaxMs === 0) {
    return;
  }
  sleep((Math.random() * data.submissionJitterMaxMs) / 1000);
}

function deriveRuntimeConfig(data: RunConfig): RunConfig {
  if (data.clientMode !== "kubernetes") {
    return data;
  }
  const vuIdInTest = (exec as { vu?: { idInTest?: number } }).vu?.idInTest ?? 1;
  return deriveRunConfigForJob(data, exec.scenario.iterationInTest, vuIdInTest - 1);
}
