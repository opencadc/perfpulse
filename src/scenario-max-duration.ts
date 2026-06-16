import type { RunConfig } from "./config";

/** Reference core budget used to estimate queue backlog for large campaigns. */
export const DEFAULT_CAMPAIGN_CORE_BUDGET = 2_000;

const SETUP_BUFFER_SECONDS = 300;
const BASE_PER_ITERATION_OVERHEAD_SECONDS = 120;

function perIterationOverheadSeconds(config: Pick<RunConfig, "skaha" | "surface">): number {
  if (config.surface === "skaha") {
    return Math.max(BASE_PER_ITERATION_OVERHEAD_SECONDS, config.skaha.requestTimeoutSeconds);
  }
  return BASE_PER_ITERATION_OVERHEAD_SECONDS;
}

export function computeScenarioMaxDurationSeconds(
  config: Pick<
    RunConfig,
    | "completionTimeoutSeconds"
    | "logicalUsers"
    | "runClass"
    | "skaha"
    | "surface"
    | "totalJobs"
    | "visibilityGateSeconds"
    | "workload"
  >,
  coreBudget = DEFAULT_CAMPAIGN_CORE_BUDGET,
): number {
  if (config.runClass === "cron" || config.totalJobs <= config.logicalUsers) {
    return (
      config.completionTimeoutSeconds +
      config.visibilityGateSeconds +
      perIterationOverheadSeconds(config) +
      SETUP_BUFFER_SECONDS
    );
  }

  const waves = Math.ceil(config.totalJobs / Math.max(config.logicalUsers, 1));
  const queueFactor = Math.max(1, Math.ceil(config.totalJobs / Math.max(coreBudget, 1)));
  const expectedJobSeconds = config.workload.durationSeconds * queueFactor;
  const perIterationSeconds =
    Math.min(config.completionTimeoutSeconds, config.visibilityGateSeconds + expectedJobSeconds) +
    perIterationOverheadSeconds(config);

  return waves * perIterationSeconds + SETUP_BUFFER_SECONDS;
}
