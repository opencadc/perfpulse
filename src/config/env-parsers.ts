import {
  isJobProfile,
  isScenario,
  isSurface,
  JOB_PROFILE_DURATIONS_SECONDS,
  type JobProfile,
  type Scenario,
  type Surface,
} from "../profiles";
import {
  CAMPAIGN_TYPES,
  type CampaignType,
  type ClientMode,
  DEFAULT_SURFACE,
  type EnvSource,
  PROFILES,
  type Profile,
  RUN_CLASSES,
  type RunClass,
  type WorkloadConfig,
} from "./profile-defaults";

export function rejectRemovedEnv(env: EnvSource): void {
  const removed: Record<string, string> = {
    COMPLETION_GATE_SECONDS: "COMPLETION_TIMEOUT_SECONDS",
    SUBMISSION_STAGGER_SECONDS: "SUBMISSION_JITTER_MAX_MS",
  };
  for (const [oldName, newName] of Object.entries(removed)) {
    if (env[oldName] !== undefined) {
      throw new Error(`${oldName} has been replaced by ${newName}`);
    }
  }
}

export function parseClientMode(value: string | undefined): ClientMode {
  if (value === undefined || value === "") {
    return "noop";
  }
  if (value === "noop" || value === "kubernetes") {
    return value;
  }
  throw new Error(`PERF_PULSE_CLIENT_MODE must be "noop" or "kubernetes", got "${value}"`);
}

export function parseProfile(value: string): Profile {
  if (isProfileValue(value)) {
    return value;
  }
  throw new Error(`PROFILE has unsupported value "${value}"`);
}

export function parseOptionalRunClass(value: string | undefined, fallback: RunClass): RunClass {
  if (value === undefined || value === "") {
    return fallback;
  }
  if (isRunClassValue(value)) {
    return value;
  }
  throw new Error(`RUN_CLASS has unsupported value "${value}"`);
}

export function parseCampaignType(
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

export function parseOptionalScenario(value: string | undefined, fallback: Scenario): Scenario {
  if (value === undefined || value === "") {
    return fallback;
  }
  if (isScenario(value)) {
    return value;
  }
  throw new Error(`SCENARIO has unsupported value "${value}"`);
}

export function parseOptionalJobProfile(
  value: string | undefined,
  fallback: JobProfile,
): JobProfile {
  if (value === undefined || value === "") {
    return fallback;
  }
  if (isJobProfile(value)) {
    return value;
  }
  throw new Error(`JOB_PROFILE has unsupported value "${value}"`);
}

export function resolveSurfaces(env: EnvSource, profile: Profile): Surface[] {
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

export function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || `${parsed}` !== value) {
    throw new Error(`${name} must be a positive integer, got "${value}"`);
  }
  return parsed;
}

export function parseNonNegativeInteger(
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

export function parseBoolean(value: string | undefined, fallback: boolean): boolean {
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

export function parseImagePullPolicy(value: string | undefined): WorkloadConfig["imagePullPolicy"] {
  if (value === undefined || value === "") {
    return "IfNotPresent";
  }
  if (value === "Always" || value === "IfNotPresent" || value === "Never") {
    return value;
  }
  throw new Error(`WORKLOAD_IMAGE_PULL_POLICY has unsupported value "${value}"`);
}

export function defaultWorkloadCommand(image: string): string[] | undefined {
  return image.startsWith("images.canfar.net/skaha/stress-ng:") ||
    image.startsWith("images.opencadc.org/platform/perfpulse:")
    ? ["stress-ng"]
    : undefined;
}

export function parseOptionalStringArray(
  value: string | undefined,
  name: string,
): string[] | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  return parseStringArray(value, undefined, name);
}

export function parseStringArray(
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

export function jobProfileDurationSeconds(jobProfile: JobProfile): number {
  return JOB_PROFILE_DURATIONS_SECONDS[jobProfile];
}

export function defaultStressNgArgs(durationSeconds: number): string[] {
  return [
    "--stressors",
    "cpu",
    "--cpu",
    "1",
    "--temp-path",
    "/tmp",
    "--timeout",
    `${durationSeconds}s`,
    "--metrics-brief",
  ];
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
