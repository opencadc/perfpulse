import { check, fail, group, sleep } from "k6";
import { b64encode } from "k6/encoding";
import * as exec from "k6/execution";
import http from "k6/http";
import { createCleanupAdapter } from "./cleanup";
import {
  deriveRunConfigForJob,
  deriveRunConfigForSurface,
  type RunConfig,
  resolveRunConfig,
} from "./config";
import {
  executeSurfaceRun,
  kubernetesJobCreateChecks,
  skahaSessionCreateChecks,
} from "./finish-surface-run";
import { createKubernetesClient, pollUntil } from "./kubernetes/api";
import { runDirectKubernetesSurface } from "./kubernetes/direct";
import { runKueueKubernetesSurface } from "./kubernetes/kueue";
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

function usesSkaha(config: RunConfig): boolean {
  return (
    config.clientMode === "kubernetes" &&
    (config.surface === "skaha" || config.surfaces.includes("skaha"))
  );
}

const serviceAccountToken =
  config.clientMode === "kubernetes" && config.surface !== "skaha"
    ? String(open(config.kubernetes.tokenPath)).trim()
    : "";
const skahaCredentials = usesSkaha(config)
  ? {
      password: String(open(config.skaha.passwordPath)),
      username: String(open(config.skaha.usernamePath)).trim(),
    }
  : undefined;

export const options = createOptions(config);

export function setup(): RuntimeData {
  console.log(
    `PerfPulse ${config.runClass}: mode=${config.clientMode} surface=${config.surface} testid=${config.testid}`,
  );
  console.log("Executor rationale: closed model for cron checks and benchmark workload deposits.");
  const setupConfig = resolveRunConfig(__ENV);
  if (setupConfig.expectedJobsEmission === "setup-once") {
    const expectedJobs =
      setupConfig.sequentialSurfaces && setupConfig.surfaces.length > 1
        ? setupConfig.totalJobs * setupConfig.surfaces.length
        : setupConfig.totalJobs;
    createLifecycleRecorder(setupConfig).recordExpected(expectedJobs);
  }
  if (usesSkaha(config)) {
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

  if (shouldRunCronSurfacesSequentially(runtimeData.config)) {
    for (const surface of runtimeData.config.surfaces) {
      const surfaceConfig = deriveRunConfigForSurface(
        deriveRunConfigForJob(runtimeData.config, 0, 0),
        surface,
      );
      runConfiguredSurface(runtimeData, surfaceConfig);
    }
    return;
  }

  runConfiguredSurface(runtimeData, runConfig);
}

function runConfiguredSurface(runtimeData: RuntimeData, runConfig: RunConfig): void {
  const recorder = createLifecycleRecorder(runConfig);
  if (runConfig.expectedJobsEmission === "per-iteration") {
    recorder.recordExpected(runConfig.totalJobs);
  }

  if (runConfig.clientMode === "noop") {
    runNoop(runConfig, recorder);
    return;
  }

  runKubernetesSurface(runtimeData, runConfig, recorder);
}

function shouldRunCronSurfacesSequentially(config: RunConfig): boolean {
  return (
    config.runClass === "cron" &&
    config.sequentialSurfaces &&
    config.surfaces.length > 1 &&
    config.clientMode === "kubernetes"
  );
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
  check(true, {
    "noop workload submitted": (ok) => ok,
    "noop workload visible": (ok) => ok,
    "noop workload completed": (ok) => ok,
  });
  sleep(data.noopSleepSeconds);
}

type KubernetesSurfaceRunner = (
  runtimeData: RuntimeData,
  data: RunConfig,
  recorder: LifecycleRecorder,
) => void;

const kubernetesSurfaceRegistry: Record<RunConfig["surface"], KubernetesSurfaceRunner> = {
  "k8s-direct": (_runtimeData, data, recorder) => runDirectKubernetes(data, recorder),
  "k8s-kueue": (_runtimeData, data, recorder) => runKueueKubernetes(data, recorder),
  skaha: (runtimeData, data, recorder) => runSkaha(runtimeData, data, recorder),
};

function runKubernetesSurface(
  runtimeData: RuntimeData,
  data: RunConfig,
  recorder: LifecycleRecorder,
): void {
  applySubmissionJitter(data);
  kubernetesSurfaceRegistry[data.surface](runtimeData, data, recorder);
}

function runDirectKubernetes(data: RunConfig, recorder: LifecycleRecorder): void {
  const client = createKubernetesClient(data, serviceAccountToken);
  const cleanup = createCleanupAdapter(data, recorder, { kubernetes: client });
  executeSurfaceRun(data, cleanup, {
    execute: () => runDirectKubernetesSurface(data, client, pollUntil, Date.now, recorder, group),
    createChecks: kubernetesJobCreateChecks("kubernetes job create returned 201"),
    cleanupWith: (adapter) => adapter.cleanupKubernetesJob(data.jobName),
  });
}

function runKueueKubernetes(data: RunConfig, recorder: LifecycleRecorder): void {
  const client = createKubernetesClient(data, serviceAccountToken);
  const cleanup = createCleanupAdapter(data, recorder, { kubernetes: client });
  executeSurfaceRun(data, cleanup, {
    execute: () =>
      runKueueKubernetesSurface(
        data,
        { ...data.kueue, userBucketIndex: data.userBucketIndex },
        client,
        pollUntil,
        Date.now,
        recorder,
        group,
      ),
    createChecks: kubernetesJobCreateChecks("kueue job create returned 201"),
    cleanupWith: (adapter) => adapter.cleanupKubernetesJob(data.jobName),
  });
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
  executeSurfaceRun(data, cleanup, {
    execute: () =>
      runSkahaSurface(
        {
          completionTimeoutSeconds: data.completionTimeoutSeconds,
          pollIntervalSeconds: data.kubernetes.pollIntervalSeconds,
          pollJitterMaxMs: data.pollJitterMaxMs,
          requireCompletion: data.requireCompletion,
          session: skahaSessionParams(data),
          visibilityGateSeconds: data.visibilityGateSeconds,
        },
        client,
        pollUntil,
        Date.now,
        recorder,
        group,
      ),
    createChecks: skahaSessionCreateChecks(),
    cleanupWith: (adapter, result) =>
      adapter.cleanupSkahaSession((result.createResponse as { sessionId: string }).sessionId),
  });
}

function skahaSessionParams(data: RunConfig) {
  return {
    args: data.workload.args,
    cmd: data.workload.command?.join(" ") ?? "stress-ng",
    cores: 1,
    env: { PERF_PULSE_TESTID: data.testid },
    image: data.workload.image,
    name: data.jobName,
    ram: 1,
  };
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
  const loginSucceeded = check(response, {
    "skaha login returned 2xx": (loginResponse) => {
      const status = (loginResponse as { status: number }).status;
      return status >= 200 && status < 300;
    },
  });
  if (!loginSucceeded) {
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
  return createSkahaBearerToken(data);
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
  if (data.sequentialSurfaces && data.surfaces.length > 1 && data.runClass === "benchmark") {
    const iterationInTest = exec.scenario.iterationInTest;
    const surfaceIndex = Math.min(
      data.surfaces.length - 1,
      Math.floor(iterationInTest / data.totalJobs),
    );
    const surface = data.surfaces[surfaceIndex] ?? data.surface;
    const jobIndexInSurface = iterationInTest % data.totalJobs;
    const surfaceConfig = deriveRunConfigForSurface(data, surface);
    return deriveRunConfigForJob(surfaceConfig, jobIndexInSurface, vuIdInTest - 1);
  }
  return deriveRunConfigForJob(data, exec.scenario.iterationInTest, vuIdInTest - 1);
}
