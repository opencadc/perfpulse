export const DEFAULT_PROFILE = "spot-direct-tiny" as const;
export const DEFAULT_RUN_CLASS = "spot" as const;
export const DEFAULT_SCENARIO = "single-bulk-user" as const;
export const DEFAULT_SURFACE = "k8s-direct" as const;
export const DEFAULT_JOB_PROFILE = "tiny" as const;
export const DEFAULT_WORKLOAD_NAMESPACE = "canfar-workloads" as const;
export const DEFAULT_WORKLOAD_IMAGE = "docker.io/alexeiled/stress-ng" as const;

export type ClientMode = "noop" | "kubernetes";
export type RunClass = typeof DEFAULT_RUN_CLASS;
export type Scenario = typeof DEFAULT_SCENARIO;
export type Surface = typeof DEFAULT_SURFACE;
export type Profile = typeof DEFAULT_PROFILE;
export type JobProfile = typeof DEFAULT_JOB_PROFILE;

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

export interface RunConfig {
  cleanup: boolean;
  clientMode: ClientMode;
  cohort: "baseline";
  completionGateSeconds: number;
  jobName: string;
  jobProfile: JobProfile;
  kubernetes: KubernetesConfig;
  logicalUsers: number;
  noopSleepSeconds: number;
  profile: Profile;
  runClass: RunClass;
  scenario: Scenario;
  surface: Surface;
  testid: string;
  userShape: string;
  visibilityGateSeconds: number;
  workload: WorkloadConfig;
}

const SERVICE_ACCOUNT_TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token";

export function resolveRunConfig(env: EnvSource = {}): RunConfig {
  const clientMode = parseClientMode(env.PERF_PULSE_CLIENT_MODE ?? env.PERFPULSE_CLIENT_MODE);
  const profile = parseExact(env.PROFILE ?? DEFAULT_PROFILE, DEFAULT_PROFILE, "PROFILE");
  const surface = parseExact(env.SURFACE ?? DEFAULT_SURFACE, DEFAULT_SURFACE, "SURFACE");
  const scenario = parseExact(env.SCENARIO ?? DEFAULT_SCENARIO, DEFAULT_SCENARIO, "SCENARIO");
  const jobProfile = parseExact(
    env.JOB_PROFILE ?? DEFAULT_JOB_PROFILE,
    DEFAULT_JOB_PROFILE,
    "JOB_PROFILE",
  );
  const testid = sanitizeLabelValue(
    env.TESTID ?? defaultTestId(clientMode),
    defaultTestId(clientMode),
  );
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
    cleanup: parseBoolean(env.CLEANUP, true),
    clientMode,
    cohort: "baseline",
    completionGateSeconds: parsePositiveInteger(
      env.COMPLETION_GATE_SECONDS,
      120,
      "COMPLETION_GATE_SECONDS",
    ),
    jobName: makeJobName(testid, 0),
    jobProfile,
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
    logicalUsers: 1,
    noopSleepSeconds: parsePositiveInteger(env.NOOP_SLEEP_SECONDS, 1, "NOOP_SLEEP_SECONDS"),
    profile,
    runClass: DEFAULT_RUN_CLASS,
    scenario,
    surface,
    testid,
    userShape: "1x1",
    visibilityGateSeconds: parsePositiveInteger(
      env.VISIBILITY_GATE_SECONDS,
      60,
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

function parseExact<T extends string>(value: string, expected: T, name: string): T {
  if (value === expected) {
    return expected;
  }
  throw new Error(`${name} must be "${expected}" for the current PerfPulse slice, got "${value}"`);
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
  switch (jobProfile) {
    case "tiny":
      return 10;
  }
}

function defaultStressNgArgs(durationSeconds: number): string[] {
  return ["--cpu", "1", "--timeout", `${durationSeconds}s`, "--metrics-brief"];
}
