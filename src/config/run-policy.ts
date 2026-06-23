import { parseBoolean } from "./env-parsers";
import type { EnvSource, RunClass, RunConfig } from "./profile-defaults";

export const FIXED_WORKLOAD_DURATION_SECONDS = 60;

export type CampaignExecutionLifecycle = "per-job";

export interface CampaignExecutionShape {
  lifecycle: CampaignExecutionLifecycle;
  iterations: number;
  waves: number;
}

export function resolveSequentialSurfaces(env: EnvSource, runClass: RunClass): boolean {
  if (env.SEQUENTIAL_SURFACES !== undefined && env.SEQUENTIAL_SURFACES !== "") {
    return parseBoolean(env.SEQUENTIAL_SURFACES, true);
  }
  if (runClass === "cron") {
    return true;
  }
  return true;
}

export function resolveCampaignExecutionShape(
  config: Pick<
    RunConfig,
    "logicalUsers" | "runClass" | "sequentialSurfaces" | "surfaces" | "totalJobs"
  >,
): CampaignExecutionShape {
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

export function resolveRequireCompletion(env: EnvSource): boolean {
  return parseBoolean(env.REQUIRE_COMPLETION, false);
}

export function validateJobsPerVuCap(
  runClass: RunClass,
  logicalUsers: number,
  totalJobs: number,
  jobsPerVuCap: number,
): void {
  if (runClass !== "benchmark") {
    return;
  }
  const minLogicalUsers = Math.ceil(totalJobs / jobsPerVuCap);
  if (logicalUsers < minLogicalUsers) {
    throw new Error(
      `Campaign requires at least ${minLogicalUsers} logical users for ${totalJobs} jobs (JOBS_PER_VU_CAP=${jobsPerVuCap}); raise LOGICAL_USERS or JOBS_PER_VU_CAP`,
    );
  }
}
