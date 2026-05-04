import type { Options } from "k6/options";
import type { RunConfig } from "./config";
import { METRIC_NAMES } from "./metrics-contract";

export function createOptions(config: RunConfig): Options {
  return {
    discardResponseBodies: false,
    insecureSkipTLSVerify: config.kubernetes.insecureSkipTLSVerify,
    scenarios: createScenarios(config),
    systemTags: ["status", "method", "name", "scenario", "group", "check"],
    thresholds: createThresholds(config),
    userAgent: "perfpulse/0.1.0",
  };
}

function createScenarios(config: RunConfig): NonNullable<Options["scenarios"]> {
  const scenarioName = config.profile.replace(/-/gu, "_");
  if (config.scenario === "throughput-stress") {
    return {
      [scenarioName]: {
        duration: "60s",
        executor: "constant-arrival-rate",
        gracefulStop: "60s",
        maxVUs: Math.max(config.logicalUsers * 2, 200),
        preAllocatedVUs: config.logicalUsers,
        rate: Math.max(1, Math.ceil(config.totalJobs / 60)),
        timeUnit: "1s",
      },
    };
  }

  return {
    [scenarioName]: {
      executor: config.scenario === "many-small-users" ? "per-vu-iterations" : "shared-iterations",
      gracefulStop: "30s",
      iterations:
        config.scenario === "many-small-users" ? config.jobsPerLogicalUser : config.totalJobs,
      maxDuration: `${config.completionGateSeconds + config.visibilityGateSeconds + 60}s`,
      vus: config.logicalUsers,
    },
  };
}

function createThresholds(config: RunConfig): NonNullable<Options["thresholds"]> {
  if (config.runClass === "stress") {
    return {
      [METRIC_NAMES.cleanupFailed]: ["count==0"],
    };
  }

  const thresholds: NonNullable<Options["thresholds"]> = {
    checks: ["rate>0.99"],
    http_req_failed: ["rate<0.01"],
    [METRIC_NAMES.cleanupFailed]: ["count==0"],
    [METRIC_NAMES.jobsSubmissionFailed]: ["count==0"],
  };

  if (config.runClass === "spot") {
    thresholds[METRIC_NAMES.jobsCompletionFailed] = ["count==0"];
    thresholds[METRIC_NAMES.jobsVisibilityFailed] = ["count==0"];
  }

  return thresholds;
}
