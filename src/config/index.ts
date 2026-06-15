import { defaultTestId, makeJobName, sanitizeLabelValue } from "./derive-job";
import {
  defaultStressNgArgs,
  defaultWorkloadCommand,
  jobProfileDurationSeconds,
  parseBoolean,
  parseCampaignType,
  parseClientMode,
  parseImagePullPolicy,
  parseNonNegativeInteger,
  parseOptionalJobProfile,
  parseOptionalRunClass,
  parseOptionalScenario,
  parseOptionalStringArray,
  parsePositiveInteger,
  parseProfile,
  parseStringArray,
  rejectRemovedEnv,
  resolveSurfaces,
} from "./env-parsers";
import {
  DEFAULT_CAMPAIGN_COMPLETION_TIMEOUT_SECONDS,
  DEFAULT_CRON_COMPLETION_TIMEOUT_SECONDS,
  DEFAULT_JITTER_MAX_MS,
  DEFAULT_JOB_PROFILE,
  DEFAULT_PROFILE,
  DEFAULT_SCENARIO,
  DEFAULT_SKAHA_API_URL,
  DEFAULT_SKAHA_LOGIN_URL,
  DEFAULT_SKAHA_PASSWORD_PATH,
  DEFAULT_SKAHA_USERNAME_PATH,
  DEFAULT_SKAHA_WORKLOAD_IMAGE,
  DEFAULT_SURFACE,
  DEFAULT_WORKLOAD_IMAGE,
  DEFAULT_WORKLOAD_NAMESPACE,
  type EnvSource,
  type RunConfig,
  SERVICE_ACCOUNT_TOKEN_PATH,
  type SkahaConfig,
} from "./profile-defaults";

export {
  defaultTestId,
  deriveRunConfigForJob,
  makeJobName,
  sanitizeDnsLabel,
  sanitizeLabelValue,
} from "./derive-job";
export type {
  CampaignType,
  ClientMode,
  EnvSource,
  JobProfile,
  KubernetesConfig,
  KueueConfig,
  Profile,
  RunClass,
  RunConfig,
  Scenario,
  SkahaConfig,
  Surface,
  WorkloadConfig,
} from "./profile-defaults";
export {
  CAMPAIGN_TYPES,
  DEFAULT_JOB_PROFILE,
  DEFAULT_PROFILE,
  DEFAULT_RUN_CLASS,
  DEFAULT_SCENARIO,
  DEFAULT_SKAHA_API_URL,
  DEFAULT_SKAHA_LOGIN_URL,
  DEFAULT_SKAHA_WORKLOAD_IMAGE,
  DEFAULT_SURFACE,
  DEFAULT_WORKLOAD_IMAGE,
  DEFAULT_WORKLOAD_NAMESPACE,
  PROFILES,
  RUN_CLASSES,
} from "./profile-defaults";

export function resolveRunConfig(env: EnvSource = {}): RunConfig {
  rejectRemovedEnv(env);
  const clientMode = parseClientMode(env.PERF_PULSE_CLIENT_MODE ?? env.PERFPULSE_CLIENT_MODE);
  const profile = parseProfile(env.PROFILE ?? DEFAULT_PROFILE);
  const runClass = parseOptionalRunClass(env.RUN_CLASS, profile);
  if (runClass !== profile) {
    throw new Error(
      `RUN_CLASS "${runClass}" does not match profile "${profile}" run_class "${profile}"`,
    );
  }
  const campaignType = parseCampaignType(env.CAMPAIGN_TYPE, runClass);
  if (campaignType === "stress" && env.CONFIRM_STRESS !== "true") {
    throw new Error("Stress campaigns require CONFIRM_STRESS=true before workloads are created");
  }

  const surfaces = resolveSurfaces(env, profile);
  const surface = surfaces[0] ?? DEFAULT_SURFACE;
  const scenario = parseOptionalScenario(env.SCENARIO, DEFAULT_SCENARIO);
  const jobProfile = parseOptionalJobProfile(
    env.JOB_PROFILE,
    campaignType === "benchmark" ? "small" : DEFAULT_JOB_PROFILE,
  );
  const testid = sanitizeLabelValue(
    env.TESTID ?? env.testid ?? defaultTestId(clientMode),
    defaultTestId(clientMode),
  );
  if (
    runClass === "campaign" &&
    (env.TOTAL_JOBS === undefined || env.LOGICAL_USERS === undefined)
  ) {
    throw new Error("Campaign runs require TOTAL_JOBS and LOGICAL_USERS");
  }
  const logicalUsers = parsePositiveInteger(env.LOGICAL_USERS, 1, "LOGICAL_USERS");
  const jobsPerSurface = parsePositiveInteger(
    env.TOTAL_JOBS ?? env.JOBS_PER_SURFACE,
    1,
    env.TOTAL_JOBS === undefined ? "JOBS_PER_SURFACE" : "TOTAL_JOBS",
  );
  if (runClass === "campaign" && logicalUsers > 25 && env.CONFIRM_HIGH_USERS !== "true") {
    throw new Error("Campaigns with more than 25 logical users require CONFIRM_HIGH_USERS=true");
  }
  if (runClass === "campaign" && jobsPerSurface > 10000 && campaignType !== "stress") {
    throw new Error("Campaigns with more than 10000 jobs per surface require CAMPAIGN_TYPE=stress");
  }
  const jobsPerLogicalUser = Math.ceil(jobsPerSurface / logicalUsers);
  const skahaConfig: SkahaConfig = {
    apiUrl: env.SKAHA_API_URL ?? DEFAULT_SKAHA_API_URL,
    loginUrl: env.SKAHA_LOGIN_URL ?? DEFAULT_SKAHA_LOGIN_URL,
    passwordPath: env.SKAHA_PASSWORD_PATH ?? DEFAULT_SKAHA_PASSWORD_PATH,
    requestTimeoutSeconds: parsePositiveInteger(
      env.SKAHA_REQUEST_TIMEOUT_SECONDS,
      30,
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
  const workloadDurationSeconds = parsePositiveInteger(
    env.WORKLOAD_DURATION_SECONDS,
    jobProfileDurationSeconds(jobProfile),
    "WORKLOAD_DURATION_SECONDS",
  );

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
      180,
      "WORKLOAD_ACTIVE_DEADLINE_SECONDS",
    ),
    args: parseStringArray(env.WORKLOAD_ARGS, defaultWorkloadArgs, "WORKLOAD_ARGS"),
    durationSeconds: workloadDurationSeconds,
    image: workloadImage,
    imagePullPolicy: parseImagePullPolicy(env.WORKLOAD_IMAGE_PULL_POLICY),
    ttlSecondsAfterFinished: parsePositiveInteger(
      env.WORKLOAD_TTL_SECONDS_AFTER_FINISHED,
      60,
      "WORKLOAD_TTL_SECONDS_AFTER_FINISHED",
    ),
  };
  if (workloadCommand !== undefined) {
    workload.command = workloadCommand;
  }
  const completionTimeoutSeconds = parsePositiveInteger(
    env.COMPLETION_TIMEOUT_SECONDS,
    runClass === "campaign"
      ? DEFAULT_CAMPAIGN_COMPLETION_TIMEOUT_SECONDS
      : DEFAULT_CRON_COMPLETION_TIMEOUT_SECONDS,
    "COMPLETION_TIMEOUT_SECONDS",
  );

  return {
    ...(campaignType === undefined ? {} : { campaignType }),
    cleanup: parseBoolean(env.CLEANUP, true),
    clientMode,
    cohort: "baseline",
    completionTimeoutSeconds,
    expectedJobsEmission: profile === "campaign" ? "setup-once" : "per-iteration",
    jobIndex: 0,
    jobName: makeJobName(testid, surface, 0),
    jobProfile,
    jobsPerLogicalUser,
    jobsPerSurface,
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
      tokenPath: env.K8S_TOKEN_PATH ?? SERVICE_ACCOUNT_TOKEN_PATH,
    },
    logicalUsers,
    metricProfile: campaignType === "stress" ? "lean" : "full",
    noopSleepSeconds: parsePositiveInteger(env.NOOP_SLEEP_SECONDS, 1, "NOOP_SLEEP_SECONDS"),
    pollJitterMaxMs: parseNonNegativeInteger(
      env.POLL_JITTER_MAX_MS,
      DEFAULT_JITTER_MAX_MS,
      "POLL_JITTER_MAX_MS",
    ),
    preserveOnFailure: parseBoolean(env.PRESERVE_ON_FAILURE, false),
    profile,
    runClass,
    scenario,
    surface,
    surfaces,
    skaha: skahaConfig,
    testid,
    testRunGrouping: runClass === "campaign" ? "separate-per-surface" : "combined",
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
  };
}
