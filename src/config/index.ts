import { defaultTestId, makeJobName, sanitizeLabelValue } from "./derive-job";
import {
  defaultStressNgArgs,
  defaultWorkloadCommand,
  parseBoolean,
  parseClientMode,
  parseImagePullPolicy,
  parseNonNegativeInteger,
  parseOptionalRunClass,
  parseOptionalScenario,
  parseOptionalStringArray,
  parsePositiveInteger,
  parseStringArray,
  rejectRemovedEnv,
  resolveSurfaces,
} from "./env-parsers";
import {
  DEFAULT_BENCHMARK_COMPLETION_TIMEOUT_SECONDS,
  DEFAULT_CRON_COMPLETION_TIMEOUT_SECONDS,
  DEFAULT_CRON_HTTP_REQ_DURATION_P95_MS,
  DEFAULT_HTTP_REQUEST_TIMEOUT_SECONDS,
  DEFAULT_JITTER_MAX_MS,
  DEFAULT_JOBS_PER_VU_CAP,
  DEFAULT_RUN_CLASS,
  DEFAULT_SCENARIO,
  DEFAULT_SKAHA_API_URL,
  DEFAULT_SKAHA_LOGIN_URL,
  DEFAULT_SKAHA_PASSWORD_PATH,
  DEFAULT_SKAHA_REQUEST_TIMEOUT_SECONDS,
  DEFAULT_SKAHA_USERNAME_PATH,
  DEFAULT_SKAHA_WORKLOAD_IMAGE,
  DEFAULT_SURFACE,
  DEFAULT_WORKLOAD_IMAGE,
  DEFAULT_WORKLOAD_NAMESPACE,
  DEFAULT_WORKLOAD_TTL_SECONDS_AFTER_FINISHED,
  type EnvSource,
  type RunConfig,
  SERVICE_ACCOUNT_TOKEN_PATH,
  type SkahaConfig,
} from "./profile-defaults";
import {
  FIXED_WORKLOAD_DURATION_SECONDS,
  resolveRequireCompletion,
  resolveSequentialSurfaces,
  validateJobsPerVuCap,
} from "./run-policy";

export {
  defaultTestId,
  deriveRunConfigForJob,
  deriveRunConfigForSurface,
  makeJobName,
  sanitizeDnsLabel,
  sanitizeLabelValue,
} from "./derive-job";
export type {
  ClientMode,
  EnvSource,
  KubernetesConfig,
  KueueConfig,
  RunClass,
  RunConfig,
  Scenario,
  SkahaConfig,
  Surface,
  WorkloadConfig,
} from "./profile-defaults";
export {
  DEFAULT_RUN_CLASS,
  DEFAULT_SCENARIO,
  DEFAULT_SKAHA_API_URL,
  DEFAULT_SKAHA_LOGIN_URL,
  DEFAULT_SKAHA_WORKLOAD_IMAGE,
  DEFAULT_SURFACE,
  DEFAULT_WORKLOAD_IMAGE,
  DEFAULT_WORKLOAD_NAMESPACE,
  RUN_CLASSES,
} from "./profile-defaults";
export type { CampaignExecutionLifecycle, CampaignExecutionShape } from "./run-policy";
export {
  FIXED_WORKLOAD_DURATION_SECONDS,
  resolveCampaignExecutionShape,
  resolveRequireCompletion,
  resolveSequentialSurfaces,
} from "./run-policy";

export function resolveRunConfig(env: EnvSource = {}): RunConfig {
  rejectRemovedEnv(env);
  const clientMode = parseClientMode(env.PERF_PULSE_CLIENT_MODE ?? env.PERFPULSE_CLIENT_MODE);
  if (env.PROFILE !== undefined && env.RUN_CLASS !== undefined && env.PROFILE !== env.RUN_CLASS) {
    throw new Error(`RUN_CLASS "${env.RUN_CLASS}" does not match legacy PROFILE "${env.PROFILE}"`);
  }
  const runClass = parseOptionalRunClass(env.RUN_CLASS ?? env.PROFILE, DEFAULT_RUN_CLASS);
  if (env.CAMPAIGN_TYPE !== undefined && env.CAMPAIGN_TYPE !== "") {
    throw new Error("CAMPAIGN_TYPE has been removed; use RUN_CLASS=benchmark");
  }

  const surfaces = resolveSurfaces(env, runClass);
  const surface = surfaces[0] ?? DEFAULT_SURFACE;
  const scenario = parseOptionalScenario(env.SCENARIO, DEFAULT_SCENARIO);
  const testid = sanitizeLabelValue(
    env.TESTID ?? env.testid ?? defaultTestId(clientMode),
    defaultTestId(clientMode),
  );
  if (
    runClass === "benchmark" &&
    (env.TOTAL_JOBS === undefined || env.LOGICAL_USERS === undefined)
  ) {
    throw new Error("Benchmark runs require TOTAL_JOBS and LOGICAL_USERS");
  }
  const logicalUsers = parsePositiveInteger(env.LOGICAL_USERS, 1, "LOGICAL_USERS");
  const jobsPerSurface = parsePositiveInteger(
    env.TOTAL_JOBS ?? env.JOBS_PER_SURFACE,
    1,
    env.TOTAL_JOBS === undefined ? "JOBS_PER_SURFACE" : "TOTAL_JOBS",
  );
  if (runClass === "benchmark" && logicalUsers > 25 && env.CONFIRM_HIGH_USERS !== "true") {
    throw new Error("Benchmarks with more than 25 logical users require CONFIRM_HIGH_USERS=true");
  }
  const jobsPerVuCap = parsePositiveInteger(
    env.JOBS_PER_VU_CAP,
    DEFAULT_JOBS_PER_VU_CAP,
    "JOBS_PER_VU_CAP",
  );
  validateJobsPerVuCap(runClass, logicalUsers, jobsPerSurface, jobsPerVuCap);
  const jobsPerLogicalUser = Math.ceil(jobsPerSurface / logicalUsers);
  const skahaConfig: SkahaConfig = {
    apiUrl: env.SKAHA_API_URL ?? DEFAULT_SKAHA_API_URL,
    loginUrl: env.SKAHA_LOGIN_URL ?? DEFAULT_SKAHA_LOGIN_URL,
    passwordPath: env.SKAHA_PASSWORD_PATH ?? DEFAULT_SKAHA_PASSWORD_PATH,
    requestTimeoutSeconds: parsePositiveInteger(
      env.SKAHA_REQUEST_TIMEOUT_SECONDS ?? env.HTTP_REQUEST_TIMEOUT_SECONDS,
      DEFAULT_SKAHA_REQUEST_TIMEOUT_SECONDS,
      "SKAHA_REQUEST_TIMEOUT_SECONDS",
    ),
    usernamePath: env.SKAHA_USERNAME_PATH ?? DEFAULT_SKAHA_USERNAME_PATH,
  };
  if (clientMode !== "noop" && surfaces.includes("skaha")) {
    if (env.SKAHA_API_URL === "" || skahaConfig.apiUrl.length === 0) {
      throw new Error("SKAHA_API_URL is required when the skaha surface is selected");
    }
    if (env.SKAHA_LOGIN_URL === "" || skahaConfig.loginUrl.length === 0) {
      throw new Error("SKAHA_LOGIN_URL is required when the skaha surface is selected");
    }
    if (skahaConfig.usernamePath.length === 0) {
      throw new Error("SKAHA_USERNAME_PATH is required when the skaha surface is selected");
    }
    if (skahaConfig.passwordPath.length === 0) {
      throw new Error("SKAHA_PASSWORD_PATH is required when the skaha surface is selected");
    }
  }
  const workloadDurationSeconds = FIXED_WORKLOAD_DURATION_SECONDS;

  const workloadImage =
    env.WORKLOAD_IMAGE ??
    (surface === "skaha" ? DEFAULT_SKAHA_WORKLOAD_IMAGE : DEFAULT_WORKLOAD_IMAGE);
  const workloadCommand =
    parseOptionalStringArray(env.WORKLOAD_COMMAND, "WORKLOAD_COMMAND") ??
    defaultWorkloadCommand(workloadImage);
  const defaultWorkloadArgs = defaultStressNgArgs(workloadDurationSeconds);
  const workload: RunConfig["workload"] = {
    activeDeadlineSeconds: parsePositiveInteger(
      env.WORKLOAD_ACTIVE_DEADLINE_SECONDS,
      Math.max(180, workloadDurationSeconds + 90),
      "WORKLOAD_ACTIVE_DEADLINE_SECONDS",
    ),
    args: parseStringArray(env.WORKLOAD_ARGS, defaultWorkloadArgs, "WORKLOAD_ARGS"),
    durationSeconds: workloadDurationSeconds,
    image: workloadImage,
    imagePullPolicy: parseImagePullPolicy(env.WORKLOAD_IMAGE_PULL_POLICY),
    ttlSecondsAfterFinished: parsePositiveInteger(
      env.WORKLOAD_TTL_SECONDS_AFTER_FINISHED,
      DEFAULT_WORKLOAD_TTL_SECONDS_AFTER_FINISHED,
      "WORKLOAD_TTL_SECONDS_AFTER_FINISHED",
    ),
  };
  if (workloadCommand !== undefined) {
    workload.command = workloadCommand;
  }
  const completionTimeoutSeconds = parsePositiveInteger(
    env.COMPLETION_TIMEOUT_SECONDS,
    runClass === "benchmark"
      ? DEFAULT_BENCHMARK_COMPLETION_TIMEOUT_SECONDS
      : DEFAULT_CRON_COMPLETION_TIMEOUT_SECONDS,
    "COMPLETION_TIMEOUT_SECONDS",
  );

  return {
    cleanup: parseBoolean(env.CLEANUP, true),
    clientMode,
    completionTimeoutSeconds,
    expectedJobsEmission: runClass === "benchmark" ? "setup-once" : "per-iteration",
    jobIndex: 0,
    jobName: makeJobName(testid, surface, 0),
    jobsPerLogicalUser,
    jobsPerSurface,
    jobsPerVuCap,
    kueue: {
      admissionGateSeconds: parsePositiveInteger(
        env.KUEUE_ADMISSION_GATE_SECONDS,
        completionTimeoutSeconds,
        "KUEUE_ADMISSION_GATE_SECONDS",
      ),
      priorityClass: env.KUEUE_PRIORITY_CLASS ?? "low",
      queueName: env.KUEUE_QUEUE_NAME ?? "cadc-default",
    },
    kubernetes: {
      apiServer: env.KUBERNETES_API_SERVER ?? "https://kubernetes.default.svc",
      insecureSkipTLSVerify: parseBoolean(env.K8S_INSECURE_SKIP_TLS_VERIFY, true),
      namespace: sanitizeLabelValue(
        env.WORKLOAD_NAMESPACE ?? DEFAULT_WORKLOAD_NAMESPACE,
        DEFAULT_WORKLOAD_NAMESPACE,
      ),
      pollIntervalSeconds: parsePositiveInteger(
        env.POLL_INTERVAL_SECONDS,
        2,
        "POLL_INTERVAL_SECONDS",
      ),
      requestTimeoutSeconds: parsePositiveInteger(
        env.KUBERNETES_REQUEST_TIMEOUT_SECONDS ?? env.HTTP_REQUEST_TIMEOUT_SECONDS,
        DEFAULT_HTTP_REQUEST_TIMEOUT_SECONDS,
        "KUBERNETES_REQUEST_TIMEOUT_SECONDS",
      ),
      tokenPath: env.K8S_TOKEN_PATH ?? SERVICE_ACCOUNT_TOKEN_PATH,
    },
    logicalUsers,
    noopSleepSeconds: parsePositiveInteger(env.NOOP_SLEEP_SECONDS, 1, "NOOP_SLEEP_SECONDS"),
    pollJitterMaxMs: parseNonNegativeInteger(
      env.POLL_JITTER_MAX_MS,
      DEFAULT_JITTER_MAX_MS,
      "POLL_JITTER_MAX_MS",
    ),
    preserveOnFailure: parseBoolean(env.PRESERVE_ON_FAILURE, false),
    requireCompletion: resolveRequireCompletion(env),
    runClass,
    scenario,
    sequentialSurfaces: resolveSequentialSurfaces(env, runClass),
    surface,
    surfaces,
    skaha: skahaConfig,
    testid,
    totalJobs: jobsPerSurface,
    userBucket: "bucket-0",
    userBucketIndex: 0,
    submissionJitterMaxMs: parseNonNegativeInteger(
      env.SUBMISSION_JITTER_MAX_MS,
      DEFAULT_JITTER_MAX_MS,
      "SUBMISSION_JITTER_MAX_MS",
    ),
    userShape: `${logicalUsers}x${jobsPerLogicalUser}`,
    visibilityGateSeconds: parsePositiveInteger(
      env.VISIBILITY_GATE_SECONDS,
      60,
      "VISIBILITY_GATE_SECONDS",
    ),
    workload,
    cronHttpReqDurationP95Ms: parsePositiveInteger(
      env.CRON_HTTP_REQ_DURATION_P95_MS,
      DEFAULT_CRON_HTTP_REQ_DURATION_P95_MS,
      "CRON_HTTP_REQ_DURATION_P95_MS",
    ),
  };
}
