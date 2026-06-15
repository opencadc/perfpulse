import type { Options } from "k6/options";
import type { RunConfig } from "./config";
import { METRIC_NAMES, metricTags } from "./metrics-contract";
import { computeScenarioMaxDurationSeconds } from "./scenario-max-duration";

export type ReadTextFile = (path: string) => string;

export function createOptions(config: RunConfig): Options {
  return {
    discardResponseBodies: false,
    insecureSkipTLSVerify: config.kubernetes.insecureSkipTLSVerify,
    scenarios: createScenarios(config),
    systemTags: ["status", "method", "name", "scenario", "group", "check"],
    tags: metricTags(config),
    thresholds: createThresholds(config),
    userAgent: "perfpulse/0.1.0",
  };
}

function createScenarios(config: RunConfig): NonNullable<Options["scenarios"]> {
  const scenarioName = config.profile.replace(/-/gu, "_");
  return {
    [scenarioName]: {
      executor: "shared-iterations",
      gracefulStop: "30s",
      iterations: config.totalJobs,
      maxDuration: `${computeScenarioMaxDurationSeconds(config)}s`,
      vus: config.logicalUsers,
    },
  };
}

function createThresholds(config: RunConfig): NonNullable<Options["thresholds"]> {
  if (config.campaignType === "stress") {
    return {
      [METRIC_NAMES.cleanupFailed]: ["count==0"],
      [METRIC_NAMES.jobsCompletionFailed]: ["count==0"],
      [METRIC_NAMES.jobsSubmissionFailed]: ["count==0"],
      [METRIC_NAMES.jobsVisibilityFailed]: ["count==0"],
    };
  }

  const thresholds: NonNullable<Options["thresholds"]> = {
    checks: ["rate>0.99"],
    http_req_failed: ["rate<0.01"],
    [METRIC_NAMES.cleanupFailed]: ["count==0"],
    [METRIC_NAMES.jobsCompletionFailed]: ["count==0"],
    [METRIC_NAMES.jobsSubmissionFailed]: ["count==0"],
    [METRIC_NAMES.jobsVisibilityFailed]: ["count==0"],
  };

  return thresholds;
}
