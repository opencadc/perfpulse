import { check, fail, sleep } from "k6";
import { b64encode } from "k6/encoding";
import * as exec from "k6/execution";
import http from "k6/http";
import { deriveRunConfigForJob, type RunConfig, resolveRunConfig } from "./config";
import { createKubernetesClient, pollUntil } from "./kubernetes/api";
import { runDirectKubernetesSurface } from "./kubernetes/direct";
import { runKueueKubernetesSurface } from "./kubernetes/kueue";
import { createCleanupAdapter } from "./cleanup";
import { createLifecycleRecorder, type LifecycleRecorder } from "./metrics";
import { metricTags } from "./metrics-contract";
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

export function setup(): RuntimeData {
  console.log(
    `PerfPulse ${config.profile}: mode=${config.clientMode} surface=${config.surface} testid=${config.testid}`,
  );
  console.log(
    "Executor rationale: closed model for cron acceptance checks; campaigns select explicit workload shape.",
  );
  const setupConfig = resolveRunConfig(__ENV);
  if (isCampaignRun(setupConfig)) {
    createLifecycleRecorder(setupConfig).recordExpected(setupConfig.totalJobs);
  }
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
  const recorder = createLifecycleRecorder(runConfig);
  if (!isCampaignRun(runConfig)) {
    recorder.recordExpected(runConfig.totalJobs);
  }

  if (runConfig.clientMode === "noop") {
    runNoop(runConfig, recorder);
    return;
  }

  runKubernetesSurface(runtimeData, runConfig, recorder);
}

export function teardown(data: RunConfig | RuntimeData): void {
  const runtimeData = normalizeRuntimeData(data);
  const runConfig = runtimeData.config;
  const recorder = createLifecycleRecorder(runConfig);
  if (!runConfig.cleanup || runConfig.clientMode !== "kubernetes") {
    return;
  }

  if (runConfig.surface === "skaha") {
    return;
  }

  const client = createKubernetesClient(runConfig, serviceAccountToken);
  createCleanupAdapter(runConfig, recorder, { kubernetes: client }).cleanupKubernetesJobsBulk();
}

function runNoop(data: RunConfig, recorder: LifecycleRecorder): void {
  recorder.recordSubmitted(1);
  recorder.recordVisible(1);
  recorder.recordCompleted(1);
  recorder.recordCleanup(0);
  check(true, {
    "noop workload submitted": (ok) => ok,
    "noop workload visible": (ok) => ok,
    "noop workload completed": (ok) => ok,
  });
  sleep(data.noopSleepSeconds);
}

function runKubernetesSurface(
  runtimeData: RuntimeData,
  data: RunConfig,
  recorder: LifecycleRecorder,
): void {
  applySubmissionJitter(data);
  switch (data.surface) {
    case "k8s-direct":
      runDirectKubernetes(data, recorder);
      return;
    case "k8s-kueue":
      runKueueKubernetes(data, recorder);
      return;
    case "skaha":
      runSkaha(runtimeData, data, recorder);
  }
}

function runDirectKubernetes(data: RunConfig, recorder: LifecycleRecorder): void {
  const client = createKubernetesClient(data, serviceAccountToken);
  const cleanup = createCleanupAdapter(data, recorder, { kubernetes: client });
  const result = runDirectKubernetesSurface(data, client, pollUntil, Date.now, recorder);
  check(result.createResponse, {
    "kubernetes job create returned 201": (response) => response.status === 201,
  });

  if (result.failure !== undefined) {
    if (result.failure.stage !== "submission") {
      cleanup.cleanupKubernetesJob(data.jobName);
    }
    fail(result.failure.message);
  }

  cleanup.cleanupKubernetesJob(data.jobName);
}

function runKueueKubernetes(data: RunConfig, recorder: LifecycleRecorder): void {
  const client = createKubernetesClient(data, serviceAccountToken);
  const cleanup = createCleanupAdapter(data, recorder, { kubernetes: client });
  const result = runKueueKubernetesSurface(
    data,
    { ...data.kueue, userBucketIndex: data.userBucketIndex },
    client,
    pollUntil,
    Date.now,
    recorder,
  );
  check(result.createResponse, {
    "kueue job create returned 201": (response) => response.status === 201,
  });

  if (result.failure !== undefined) {
    if (result.failure.stage !== "submission") {
      cleanup.cleanupKubernetesJob(data.jobName);
    }
    fail(result.failure.message);
  }

  cleanup.cleanupKubernetesJob(data.jobName);
}

function runSkaha(runtimeData: RuntimeData, data: RunConfig, recorder: LifecycleRecorder): void {
  const client = createSkahaClient({
    apiUrl: data.skaha.apiUrl,
    http,
    registryAuthHeader: runtimeData.skahaRegistryAuthHeader,
    runConfig: data,
    token: resolveSkahaBearerToken(runtimeData, data),
  });
  const cleanup = createCleanupAdapter(data, recorder, { skaha: client });
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
    Date.now,
    recorder,
  );
  if (result.failure !== undefined) {
    cleanup.cleanupSkahaSession(result.createResponse.sessionId);
    fail(result.failure.message);
  }

  cleanup.cleanupSkahaSession(result.createResponse.sessionId);
}

function isCampaignRun(config: RunConfig): boolean {
  return config.profile === "campaign" || config.runClass === "campaign";
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
