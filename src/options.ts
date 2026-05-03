import type { Options } from "k6/options";
import type { RunConfig } from "./config";
import { METRIC_NAMES } from "./metrics-contract";

export function createOptions(config: RunConfig): Options {
  return {
    discardResponseBodies: false,
    insecureSkipTLSVerify: config.kubernetes.insecureSkipTLSVerify,
    scenarios: {
      spot_direct_tiny: {
        executor: "shared-iterations",
        gracefulStop: "30s",
        iterations: 1,
        maxDuration: `${config.completionGateSeconds + config.visibilityGateSeconds + 60}s`,
        vus: 1,
      },
    },
    systemTags: ["status", "method", "name", "scenario", "group", "check", "error"],
    thresholds: {
      checks: ["rate>0.99"],
      http_req_failed: ["rate<0.01"],
      [METRIC_NAMES.cleanupFailed]: ["count==0"],
      [METRIC_NAMES.jobsCompletionFailed]: ["count==0"],
      [METRIC_NAMES.jobsSubmissionFailed]: ["count==0"],
      [METRIC_NAMES.jobsVisibilityFailed]: ["count==0"],
    },
    userAgent: "perfpulse/0.1.0",
  };
}
