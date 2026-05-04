import {
  isJobProfile,
  isProfile,
  isRunClass,
  isScenario,
  isSurface,
  JOB_PROFILE_DURATIONS_SECONDS,
  type JobProfile,
  type MetricProfile,
  PROFILE_DEFINITIONS,
  type Profile,
  type RunClass,
  type Scenario,
  type Surface,
  type TestRunGrouping,
} from "./profiles";

export type { JobProfile, Profile, RunClass, Scenario, Surface } from "./profiles";

export const DEFAULT_PROFILE = "spot-direct-tiny" as const;
export const DEFAULT_RUN_CLASS = "spot" as const;
export const DEFAULT_SCENARIO = "single-bulk-user" as const;
export const DEFAULT_SURFACE = "k8s-direct" as const;
export const DEFAULT_JOB_PROFILE = "tiny" as const;
export const DEFAULT_WORKLOAD_NAMESPACE = "canfar-workloads" as const;
export const DEFAULT_WORKLOAD_IMAGE = "docker.io/alexeiled/stress-ng" as const;

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
  token: string;
}

export interface RunConfig {
  cleanup: boolean;
  clientMode: ClientMode;
  cohort: "baseline";
  completionGateSeconds: number;
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
  userShape: string;
  visibilityGateSeconds: number;
  workload: WorkloadConfig;
}

const SERVICE_ACCOUNT_TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token";

export function resolveRunConfig(env: EnvSource = {}): RunConfig {
  const clientMode = parseClientMode(env.PERF_PULSE_CLIENT_MODE ?? env.PERFPULSE_CLIENT_MODE);
  const profile = parseProfile(env.PROFILE ?? DEFAULT_PROFILE);
  const profileDefinition = PROFILE_DEFINITIONS[profile];
  const runClass = parseOptionalRunClass(env.RUN_CLASS, profileDefinition.runClass);
  if (runClass !== profileDefinition.runClass) {
    throw new Error(
      `RUN_CLASS "${runClass}" does not match profile "${profile}" run_class "${profileDefinition.runClass}"`,
    );
  }
  if (runClass === "stress" && env.CONFIRM_STRESS !== "true") {
    throw new Error(
      `Profile "${profile}" requires CONFIRM_STRESS=true before workloads are created`,
    );
  }

  const surfaces = resolveSurfaces(env, profile);
  const surface = surfaces[0] ?? DEFAULT_SURFACE;
  const scenario = parseOptionalScenario(env.SCENARIO, profileDefinition.scenario);
  const jobProfile = parseOptionalJobProfile(env.JOB_PROFILE, profileDefinition.jobProfile);
  const testid = sanitizeLabelValue(
    env.TESTID ?? env.testid ?? defaultTestId(clientMode),
    defaultTestId(clientMode),
  );
  const logicalUsers = parsePositiveInteger(
    env.LOGICAL_USERS,
    profileDefinition.logicalUsers,
    "LOGICAL_USERS",
  );
  const jobsPerSurface = parsePositiveInteger(
    env.TOTAL_JOBS ?? env.JOBS_PER_SURFACE,
    profileDefinition.jobsPerSurface,
    env.TOTAL_JOBS === undefined ? "JOBS_PER_SURFACE" : "TOTAL_JOBS",
  );
  if (jobsPerSurface % logicalUsers !== 0) {
    throw new Error(
      `TOTAL_JOBS/JOBS_PER_SURFACE (${jobsPerSurface}) must divide evenly across LOGICAL_USERS (${logicalUsers})`,
    );
  }
  const jobsPerLogicalUser = jobsPerSurface / logicalUsers;
  const skahaConfig: SkahaConfig = {
    apiUrl: env.SKAHA_API_URL ?? "",
    token: env.SKAHA_TOKEN ?? "",
  };
  if (clientMode !== "noop" && surfaces.includes("skaha")) {
    if (skahaConfig.apiUrl.length === 0) {
      throw new Error("SKAHA_API_URL is required when the skaha surface is selected");
    }
    if (skahaConfig.token.length === 0) {
      throw new Error("SKAHA_TOKEN is required when the skaha surface is selected");
    }
  }
  const workloadDurationSeconds = parsePositiveInteger(
    env.WORKLOAD_DURATION_SECONDS,
    jobProfileDurationSeconds(jobProfile),
    "WORKLOAD_DURATION_SECONDS",
  );

  const workloadCommand = parseOptionalStringArray(env.WORKLOAD_COMMAND, "WORKLOAD_COMMAND");
  const workload: WorkloadConfig = {
    activeDeadlineSeconds: parsePositiveInteger(
      env.WORKLOAD_ACTIVE_DEADLINE_SECONDS,
      180,
      "WORKLOAD_ACTIVE_DEADLINE_SECONDS",
    ),
    args: parseStringArray(
      env.WORKLOAD_ARGS,
      defaultStressNgArgs(workloadDurationSeconds),
      "WORKLOAD_ARGS",
    ),
    durationSeconds: workloadDurationSeconds,
    image: env.WORKLOAD_IMAGE ?? DEFAULT_WORKLOAD_IMAGE,
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
    cleanup: parseBoolean(env.CLEANUP, profileDefinition.cleanup),
    clientMode,
    cohort: "baseline",
    completionGateSeconds: parsePositiveInteger(
      env.COMPLETION_GATE_SECONDS,
      profileDefinition.completionGateSeconds ?? 120,
      "COMPLETION_GATE_SECONDS",
    ),
    jobName: makeJobName(testid, 0),
    jobProfile,
    jobsPerLogicalUser,
    jobsPerSurface,
    kueue: {
      admissionGateSeconds: parsePositiveInteger(
        env.KUEUE_ADMISSION_GATE_SECONDS,
        profileDefinition.completionGateSeconds ?? 120,
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
    metricProfile: profileDefinition.metricProfile,
    noopSleepSeconds: parsePositiveInteger(env.NOOP_SLEEP_SECONDS, 1, "NOOP_SLEEP_SECONDS"),
    preserveOnFailure: parseBoolean(env.PRESERVE_ON_FAILURE, profileDefinition.preserveOnFailure),
    profile,
    runClass,
    scenario,
    surface,
    surfaces,
    skaha: skahaConfig,
    testid,
    testRunGrouping: profileDefinition.testRunGrouping,
    totalJobs: jobsPerSurface,
    userShape: `${logicalUsers}x${jobsPerLogicalUser}`,
    visibilityGateSeconds: parsePositiveInteger(
      env.VISIBILITY_GATE_SECONDS,
      profileDefinition.visibilityGateSeconds ?? 60,
      "VISIBILITY_GATE_SECONDS",
    ),
    workload,
  };
}

export function defaultTestId(clientMode: ClientMode): string {
  return clientMode === "kubernetes" ? "kind-smoke" : "local-noop";
}

export function makeJobName(testid: string, index: number): string {
  const suffix = `-${index}`;
  const prefix = "perfpulse-";
  const budget = 63 - prefix.length - suffix.length;
  const compact = sanitizeDnsLabel(testid, "run").slice(0, budget).replace(/-+$/u, "");
  return `${prefix}${compact}${suffix}`;
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
  if (isProfile(value)) {
    return value;
  }
  throw new Error(`PROFILE has unsupported value "${value}"`);
}

function parseOptionalRunClass(value: string | undefined, fallback: RunClass): RunClass {
  if (value === undefined || value === "") {
    return fallback;
  }
  if (isRunClass(value)) {
    return value;
  }
  throw new Error(`RUN_CLASS has unsupported value "${value}"`);
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
    return [...PROFILE_DEFINITIONS[profile].surfaces];
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
