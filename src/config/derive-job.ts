import type { Surface } from "../profiles";
import type { ClientMode, RunConfig } from "./profile-defaults";

export function deriveRunConfigForJob(
  config: RunConfig,
  jobIndex: number,
  userBucketIndex = Math.min(
    config.logicalUsers - 1,
    Math.floor(jobIndex / config.jobsPerLogicalUser),
  ),
): RunConfig {
  if (!Number.isInteger(jobIndex) || jobIndex < 0) {
    throw new Error(`Job index must be a non-negative integer, got ${jobIndex}`);
  }
  if (!Number.isInteger(userBucketIndex) || userBucketIndex < 0) {
    throw new Error(`User bucket index must be a non-negative integer, got ${userBucketIndex}`);
  }
  const boundedUserBucketIndex = Math.min(config.logicalUsers - 1, userBucketIndex);

  return {
    ...config,
    jobIndex,
    jobName: makeJobName(config.testid, config.surface, jobIndex),
    userBucket: `bucket-${boundedUserBucketIndex}`,
    userBucketIndex: boundedUserBucketIndex,
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
