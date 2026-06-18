import { parseBoolean } from "./env-parsers";
import type { CampaignType, EnvSource, RunClass, RunConfig, Surface } from "./profile-defaults";

export const FIXED_WORKLOAD_DURATION_SECONDS = 60;

export type CampaignExecutionLifecycle = "per-job" | "bulk-skaha-stress";

export interface CampaignExecutionShape {
  lifecycle: CampaignExecutionLifecycle;
  iterations: number;
  waves: number;
}

export function resolveSequentialSurfaces(
  env: EnvSource,
  runClass: RunClass,
  campaignType: CampaignType | undefined,
): boolean {
  if (env.SEQUENTIAL_SURFACES !== undefined && env.SEQUENTIAL_SURFACES !== "") {
    return parseBoolean(env.SEQUENTIAL_SURFACES, true);
  }
  if (runClass === "cron") {
    return true;
  }
  if (campaignType === "stress") {
    return false;
  }
  return true;
}

export function resolveCampaignExecutionShape(
  config: Pick<
    RunConfig,
    | "campaignType"
    | "logicalUsers"
    | "runClass"
    | "sequentialSurfaces"
    | "surface"
    | "surfaces"
    | "totalJobs"
  >,
): CampaignExecutionShape {
  const isBulkSkahaStress =
    config.runClass === "campaign" &&
    config.surface === "skaha" &&
    config.campaignType === "stress";

  if (isBulkSkahaStress) {
    return {
      lifecycle: "bulk-skaha-stress",
      iterations: config.logicalUsers,
      waves: 1,
    };
  }

  if (config.runClass === "cron") {
    return {
      lifecycle: "per-job",
      iterations: 1,
      waves: 1,
    };
  }

  const surfaceCount =
    config.sequentialSurfaces && config.surfaces.length > 1 ? config.surfaces.length : 1;
  const iterations = config.totalJobs * surfaceCount;

  return {
    lifecycle: "per-job",
    iterations,
    waves: Math.ceil(iterations / Math.max(config.logicalUsers, 1)),
  };
}

export function isBulkSkahaStressSurface(surface: Surface, shape: CampaignExecutionShape): boolean {
  return surface === "skaha" && shape.lifecycle === "bulk-skaha-stress";
}

export function resolveRequireCompletion(
  env: EnvSource,
  runClass: RunClass,
  campaignType: CampaignType | undefined,
): boolean {
  if (runClass === "cron") {
    if (env.REQUIRE_COMPLETION === "false") {
      throw new Error("REQUIRE_COMPLETION cannot be disabled for cron checks");
    }
    return true;
  }
  if (campaignType === "stress") {
    return parseBoolean(env.REQUIRE_COMPLETION, false);
  }
  return parseBoolean(env.REQUIRE_COMPLETION, true);
}

export function validateJobsPerVuCap(
  runClass: RunClass,
  logicalUsers: number,
  totalJobs: number,
  jobsPerVuCap: number,
): void {
  if (runClass !== "campaign") {
    return;
  }
  const minLogicalUsers = Math.ceil(totalJobs / jobsPerVuCap);
  if (logicalUsers < minLogicalUsers) {
    throw new Error(
      `Campaign requires at least ${minLogicalUsers} logical users for ${totalJobs} jobs (JOBS_PER_VU_CAP=${jobsPerVuCap}); raise LOGICAL_USERS or JOBS_PER_VU_CAP`,
    );
  }
}
