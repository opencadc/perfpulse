import { parseBoolean } from "./env-parsers";
import type { CampaignType, EnvSource, RunClass } from "./profile-defaults";

export const FIXED_WORKLOAD_DURATION_SECONDS = 60;
export const SEQUENTIAL_CAMPAIGN_THRESHOLD = 100;

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

export function validateSequentialCampaignMode(
  env: EnvSource,
  runClass: RunClass,
  logicalUsers: number,
  jobsPerSurface: number,
): void {
  if (
    runClass === "campaign" &&
    logicalUsers === 1 &&
    jobsPerSurface > SEQUENTIAL_CAMPAIGN_THRESHOLD &&
    env.CONFIRM_SEQUENTIAL !== "true"
  ) {
    throw new Error("Sequential campaign mode requires CONFIRM_SEQUENTIAL=true");
  }
}
