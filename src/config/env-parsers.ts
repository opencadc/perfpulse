import { isScenario, isSurface, type Scenario, type Surface } from "../profiles";
import {
  type ClientMode,
  DEFAULT_SURFACE,
  type EnvSource,
  RUN_CLASSES,
  type RunClass,
  type WorkloadConfig,
} from "./profile-defaults";

export function rejectRemovedEnv(env: EnvSource): void {
  const removed: Record<string, string> = {
    COMPLETION_GATE_SECONDS: "COMPLETION_TIMEOUT_SECONDS",
    JOB_PROFILE: "fixed 60 second workload runtime",
    SUBMISSION_STAGGER_SECONDS: "SUBMISSION_JITTER_MAX_MS",
    WORKLOAD_DURATION_SECONDS: "fixed 60 second workload runtime",
  };
  for (const [oldName, replacement] of Object.entries(removed)) {
    if (env[oldName] !== undefined) {
      const message =
        oldName === "JOB_PROFILE"
          ? "JOB_PROFILE has been removed; workload runtime is fixed at 60 seconds"
          : oldName === "WORKLOAD_DURATION_SECONDS"
            ? "WORKLOAD_DURATION_SECONDS is fixed at 60 seconds"
            : `${oldName} has been replaced by ${replacement}`;
      throw new Error(message);
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

export function parseOptionalRunClass(value: string | undefined, fallback: RunClass): RunClass {
  if (value === undefined || value === "") {
    return fallback;
  }
  if (isRunClassValue(value)) {
    return value;
  }
  throw new Error(`RUN_CLASS has unsupported value "${value}"`);
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

export function resolveSurfaces(env: EnvSource, runClass: RunClass): Surface[] {
  if (env.SURFACE !== undefined && env.SURFACES !== undefined) {
    throw new Error("Use either SURFACE or SURFACES, not both");
  }

  const value = env.SURFACES ?? env.SURFACE;
  if (value === undefined || value === "") {
    return runClass === "benchmark" ? ["k8s-kueue", "k8s-direct", "skaha"] : [DEFAULT_SURFACE];
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

export function defaultStressNgArgs(durationSeconds: number): string[] {
  return [
    "--cpu",
    "1",
    "--temp-path",
    "/tmp",
    "--timeout",
    `${durationSeconds}s`,
    "--metrics-brief",
  ];
}

function isRunClassValue(value: string): value is RunClass {
  return (RUN_CLASSES as readonly string[]).includes(value);
}
