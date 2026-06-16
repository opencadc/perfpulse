import type { Options } from "k6/options";
import { type RunConfig, resolveCampaignExecutionShape } from "./config";
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
  const iterations = scenarioIterations(config);
  return {
    [scenarioName]: {
      executor: "shared-iterations",
      gracefulStop: "30s",
      iterations,
      maxDuration: `${computeScenarioMaxDurationSeconds(config)}s`,
      vus: config.logicalUsers,
    },
  };
}

function scenarioIterations(config: RunConfig): number {
  return resolveCampaignExecutionShape(config).iterations;
}

export const CRON_HTTP_REQ_DURATION_P95_MS = 500;

function createThresholds(config: RunConfig): NonNullable<Options["thresholds"]> {
  const lifecycleThresholds = {
    [METRIC_NAMES.cleanupFailed]: ["count==0"],
    [METRIC_NAMES.jobsCompletionFailed]: ["count==0"],
    [METRIC_NAMES.jobsSubmissionFailed]: ["count==0"],
    [METRIC_NAMES.jobsVisibilityFailed]: ["count==0"],
  };

  if (config.campaignType === "stress") {
    const stressThresholds =
      resolveCampaignExecutionShape(config).lifecycle === "bulk-skaha-stress"
        ? {
            [METRIC_NAMES.cleanupFailed]: lifecycleThresholds[METRIC_NAMES.cleanupFailed],
            [METRIC_NAMES.jobsSubmissionFailed]:
              lifecycleThresholds[METRIC_NAMES.jobsSubmissionFailed],
            [METRIC_NAMES.jobsVisibilityFailed]:
              lifecycleThresholds[METRIC_NAMES.jobsVisibilityFailed],
          }
        : lifecycleThresholds;

    return {
      ...stressThresholds,
      http_req_failed: ["rate==0"],
    };
  }

  return {
    checks: config.runClass === "cron" ? ["rate==1"] : ["rate>0.99"],
    http_req_failed: config.runClass === "cron" ? ["rate==0"] : ["rate<0.01"],
    ...(config.runClass === "cron"
      ? { http_req_duration: [`p(95)<${CRON_HTTP_REQ_DURATION_P95_MS}`] }
      : {}),
    ...lifecycleThresholds,
  };
}
