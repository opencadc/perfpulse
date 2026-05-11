import {
  isJobProfile,
  isScenario,
  isSurface,
  JOB_PROFILE_DURATIONS_SECONDS,
  type JobProfile,
  type MetricProfile,
  type Scenario,
  type Surface,
  type TestRunGrouping,
} from "./profiles";

export type { JobProfile, Scenario, Surface } from "./profiles";

export const RUN_CLASSES = ["cron", "campaign"] as const;
export const CAMPAIGN_TYPES = ["benchmark", "stress"] as const;
export const PROFILES = ["cron", "campaign"] as const;

export type RunClass = (typeof RUN_CLASSES)[number];
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];
export type Profile = (typeof PROFILES)[number];

export const DEFAULT_PROFILE = "cron" as const;
export const DEFAULT_RUN_CLASS = "cron" as const;
export const DEFAULT_SCENARIO = "single-bulk-user" as const;
export const DEFAULT_SURFACE = "k8s-direct" as const;
export const DEFAULT_JOB_PROFILE = "tiny" as const;
export const DEFAULT_WORKLOAD_NAMESPACE = "canfar-workloads" as const;
export const DEFAULT_WORKLOAD_IMAGE = "images.canfar.net/skaha/stress-ng:latest" as const;
export const DEFAULT_SKAHA_WORKLOAD_IMAGE = DEFAULT_WORKLOAD_IMAGE;
export const DEFAULT_SKAHA_API_URL =
  "http://canfar-skaha-staging-skaha-tomcat-svc.canfar-system-staging.svc.keel-prod.local:8080/skaha/v1" as const;
export const DEFAULT_SKAHA_LOGIN_URL = "https://ws-cadc.canfar.net/ac/login" as const;

export type ClientMode = "noop" | "kubernetes";

export interface EnvSource {
  [key: string]: string | undefined;
}

export interface WorkloadConfig {
  activeDeadlineSeconds: number;
  args: string[];
  command?: string[];
  durationSeconds: number;
  image: string;
  imagePullPolicy: "Always" | "IfNotPresent" | "Never";
  ttlSecondsAfterFinished: number;
}

export interface KubernetesConfig {
  apiServer: string;
  insecureSkipTLSVerify: boolean;
  namespace: string;
  pollIntervalSeconds: number;
  tokenPath: string;
}

export interface KueueConfig {
  admissionGateSeconds: number;
  priorityClass: string;
  queueName: string;
}

export interface SkahaConfig {
  apiUrl: string;
  loginUrl: string;
  passwordPath: string;
  requestTimeoutSeconds: number;
  submissionStaggerSeconds: number;
  usernamePath: string;
}

export interface RunConfig {
  campaignType?: CampaignType;
  cleanup: boolean;
  clientMode: ClientMode;
  cohort: "baseline";
  completionGateSeconds: number;
  jobIndex: number;
  jobName: string;
  jobProfile: JobProfile;
  jobsPerLogicalUser: number;
  jobsPerSurface: number;
  kueue: KueueConfig;
  kubernetes: KubernetesConfig;
  logicalUsers: number;
  metricProfile: MetricProfile;
  noopSleepSeconds: number;
  preserveOnFailure: boolean;
  profile: Profile;
  runClass: RunClass;
  scenario: Scenario;
  surface: Surface;
  surfaces: Surface[];
  skaha: SkahaConfig;
  testid: string;
  testRunGrouping: TestRunGrouping;
  totalJobs: number;
  userBucket: string;
  userBucketIndex: number;
  userShape: string;
  visibilityGateSeconds: number;
  workload: WorkloadConfig;
}

const SERVICE_ACCOUNT_TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token";
const DEFAULT_SKAHA_PASSWORD_PATH = "/var/run/secrets/perfpulse/skaha-auth/password";
const DEFAULT_SKAHA_USERNAME_PATH = "/var/run/secrets/perfpulse/skaha-auth/username";

export function resolveRunConfig(env: EnvSource = {}): RunConfig {
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
  const scenario = parseOptionalScenario(
    env.SCENARIO,
    campaignType === "stress" ? "throughput-stress" : DEFAULT_SCENARIO,
  );
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
  if (jobsPerSurface % logicalUsers !== 0) {
    throw new Error(
      `TOTAL_JOBS/JOBS_PER_SURFACE (${jobsPerSurface}) must divide evenly across LOGICAL_USERS (${logicalUsers})`,
    );
  }
  if (runClass === "campaign" && logicalUsers > 25 && env.CONFIRM_HIGH_USERS !== "true") {
    throw new Error("Campaigns with more than 25 logical users require CONFIRM_HIGH_USERS=true");
  }
  if (runClass === "campaign" && jobsPerSurface > 10000 && campaignType !== "stress") {
    throw new Error("Campaigns with more than 10000 jobs per surface require CAMPAIGN_TYPE=stress");
  }
  const jobsPerLogicalUser = jobsPerSurface / logicalUsers;
  const skahaConfig: SkahaConfig = {
    apiUrl: env.SKAHA_API_URL ?? DEFAULT_SKAHA_API_URL,
    loginUrl: env.SKAHA_LOGIN_URL ?? DEFAULT_SKAHA_LOGIN_URL,
    passwordPath: env.SKAHA_PASSWORD_PATH ?? DEFAULT_SKAHA_PASSWORD_PATH,
    requestTimeoutSeconds: parsePositiveInteger(
      env.SKAHA_REQUEST_TIMEOUT_SECONDS,
      30,
      "SKAHA_REQUEST_TIMEOUT_SECONDS",
    ),
    submissionStaggerSeconds: parseNonNegativeInteger(
      env.SUBMISSION_STAGGER_SECONDS,
      0,
      "SUBMISSION_STAGGER_SECONDS",
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
  const workload: WorkloadConfig = {
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

  return {
    ...(campaignType === undefined ? {} : { campaignType }),
    cleanup: parseBoolean(env.CLEANUP, true),
    clientMode,
    cohort: "baseline",
    completionGateSeconds: parsePositiveInteger(
      env.COMPLETION_GATE_SECONDS,
      120,
      "COMPLETION_GATE_SECONDS",
    ),
    jobIndex: 0,
    jobName: makeJobName(testid, surface, 0),
    jobProfile,
    jobsPerLogicalUser,
    jobsPerSurface,
    kueue: {
      admissionGateSeconds: parsePositiveInteger(
        env.KUEUE_ADMISSION_GATE_SECONDS,
        120,
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
    userShape: `${logicalUsers}x${jobsPerLogicalUser}`,
    visibilityGateSeconds: parsePositiveInteger(
      env.VISIBILITY_GATE_SECONDS,
      60,
      "VISIBILITY_GATE_SECONDS",
    ),
    workload,
  };
}

export function deriveRunConfigForJob(config: RunConfig, jobIndex: number): RunConfig {
  if (!Number.isInteger(jobIndex) || jobIndex < 0) {
    throw new Error(`Job index must be a non-negative integer, got ${jobIndex}`);
  }

  const userBucketIndex = Math.min(
    config.logicalUsers - 1,
    Math.floor(jobIndex / config.jobsPerLogicalUser),
  );

  return {
    ...config,
    jobIndex,
    jobName: makeJobName(config.testid, config.surface, jobIndex),
    userBucket: `bucket-${userBucketIndex}`,
    userBucketIndex,
  };
}

export function defaultTestId(clientMode: ClientMode): string {
  return clientMode === "kubernetes" ? "kind-smoke" : "local-noop";
}

export function makeJobName(testid: string, surface: Surface, index: number): string {
  const suffix = `-${jobNameSurfaceToken(surface)}-${index}`;
  const prefix = "perfpulse-";
  const budget = 63 - prefix.length - suffix.length;
  const compact = sanitizeDnsLabel(testid, "run").slice(0, budget).replace(/-+$/u, "");
  return `${prefix}${compact}${suffix}`;
}

function jobNameSurfaceToken(surface: Surface): string {
  switch (surface) {
    case "k8s-direct":
      return "direct";
    case "k8s-kueue":
      return "kueue";
    case "skaha":
      return "skaha";
  }
}

export function sanitizeDnsLabel(value: string, fallback: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .replace(/-+/gu, "-");
  return sanitized.length > 0 ? sanitized : fallback;
}

export function sanitizeLabelValue(value: string, fallback: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/gu, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gu, "")
    .replace(/-+/gu, "-");
  const truncated = sanitized.slice(0, 63).replace(/^[^a-z0-9]+|[^a-z0-9]+$/gu, "");
  return truncated.length > 0 ? truncated : fallback;
}

function parseClientMode(value: string | undefined): ClientMode {
  if (value === undefined || value === "") {
    return "noop";
  }
  if (value === "noop" || value === "kubernetes") {
    return value;
  }
  throw new Error(`PERF_PULSE_CLIENT_MODE must be "noop" or "kubernetes", got "${value}"`);
}

function parseProfile(value: string): Profile {
  if (isProfileValue(value)) {
    return value;
  }
  throw new Error(`PROFILE has unsupported value "${value}"`);
}

function parseOptionalRunClass(value: string | undefined, fallback: RunClass): RunClass {
  if (value === undefined || value === "") {
    return fallback;
  }
  if (isRunClassValue(value)) {
    return value;
  }
  throw new Error(`RUN_CLASS has unsupported value "${value}"`);
}

function parseCampaignType(
  value: string | undefined,
  runClass: RunClass,
): CampaignType | undefined {
  if (runClass === "cron") {
    if (value === undefined || value === "") {
      return undefined;
    }
    throw new Error("CAMPAIGN_TYPE is only supported when RUN_CLASS/PROFILE is campaign");
  }
  if (value === undefined || value === "") {
    throw new Error("Campaign runs require CAMPAIGN_TYPE benchmark or stress");
  }
  if (isCampaignTypeValue(value)) {
    return value;
  }
  throw new Error(`CAMPAIGN_TYPE has unsupported value "${value}"`);
}

function isProfileValue(value: string): value is Profile {
  return (PROFILES as readonly string[]).includes(value);
}

function isRunClassValue(value: string): value is RunClass {
  return (RUN_CLASSES as readonly string[]).includes(value);
}

function isCampaignTypeValue(value: string): value is CampaignType {
  return (CAMPAIGN_TYPES as readonly string[]).includes(value);
}

function parseOptionalScenario(value: string | undefined, fallback: Scenario): Scenario {
  if (value === undefined || value === "") {
    return fallback;
  }
  if (isScenario(value)) {
    return value;
  }
  throw new Error(`SCENARIO has unsupported value "${value}"`);
}

function parseOptionalJobProfile(value: string | undefined, fallback: JobProfile): JobProfile {
  if (value === undefined || value === "") {
    return fallback;
  }
  if (isJobProfile(value)) {
    return value;
  }
  throw new Error(`JOB_PROFILE has unsupported value "${value}"`);
}

function resolveSurfaces(env: EnvSource, profile: Profile): Surface[] {
  if (env.SURFACE !== undefined && env.SURFACES !== undefined) {
    throw new Error("Use either SURFACE or SURFACES, not both");
  }

  const value = env.SURFACES ?? env.SURFACE;
  if (value === undefined || value === "") {
    return profile === "campaign" ? ["k8s-kueue", "k8s-direct", "skaha"] : [DEFAULT_SURFACE];
  }

  const surfaces = value.split(",").map((surface) => surface.trim());
  if (surfaces.length === 0 || surfaces.some((surface) => surface.length === 0)) {
    throw new Error("SURFACE/SURFACES must contain one or more supported surfaces");
  }
  const uniqueSurfaces = [...new Set(surfaces)];
  if (uniqueSurfaces.includes("noop")) {
    throw new Error("No-op is a client mode only; it is not a surface value");
  }
  for (const surface of uniqueSurfaces) {
    if (!isSurface(surface)) {
      throw new Error(`SURFACE/SURFACES has unsupported value "${surface}"`);
    }
  }

  return uniqueSurfaces as Surface[];
}

function parsePositiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || `${parsed}` !== value) {
    throw new Error(`${name} must be a positive integer, got "${value}"`);
  }
  return parsed;
}

function parseNonNegativeInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || `${parsed}` !== value) {
    throw new Error(`${name} must be a non-negative integer, got "${value}"`);
  }
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") {
    return fallback;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`Boolean values must be "true" or "false", got "${value}"`);
}

function parseImagePullPolicy(value: string | undefined): WorkloadConfig["imagePullPolicy"] {
  if (value === undefined || value === "") {
    return "IfNotPresent";
  }
  if (value === "Always" || value === "IfNotPresent" || value === "Never") {
    return value;
  }
  throw new Error(`WORKLOAD_IMAGE_PULL_POLICY has unsupported value "${value}"`);
}

function defaultWorkloadCommand(image: string): string[] | undefined {
  return image.startsWith("images.canfar.net/skaha/stress-ng:") ||
    image.startsWith("images.opencadc.org/platform/perfpulse:")
    ? ["stress-ng"]
    : undefined;
}

function parseOptionalStringArray(value: string | undefined, name: string): string[] | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  return parseStringArray(value, undefined, name);
}

function parseStringArray(
  value: string | undefined,
  fallback: string[] | undefined,
  name: string,
): string[] {
  if (value === undefined || value === "") {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error(`${name} must be a JSON array of strings`);
  }
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON array of strings`);
  }
  if (parsed.length === 0 || !parsed.every((item) => typeof item === "string")) {
    throw new Error(`${name} must be a non-empty JSON array of strings`);
  }
  return parsed;
}

function jobProfileDurationSeconds(jobProfile: JobProfile): number {
  return JOB_PROFILE_DURATIONS_SECONDS[jobProfile];
}

function defaultStressNgArgs(durationSeconds: number): string[] {
  return ["--cpu", "1", "--timeout", `${durationSeconds}s`, "--metrics-brief"];
}
