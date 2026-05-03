import { describe, expect, test } from "bun:test";
import { resolveRunConfig } from "../src/config";
import { KUBERNETES_LABEL_KEYS, testidSelector, workloadLabels } from "../src/labels";

describe("PerfPulse Kubernetes labels", () => {
  test("generates the stable Kind smoke workload label contract", () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      TESTID: "Kind Smoke 01",
    });

    expect(workloadLabels(config)).toEqual({
      [KUBERNETES_LABEL_KEYS.appName]: "perfpulse",
      [KUBERNETES_LABEL_KEYS.managedBy]: "k6",
      [KUBERNETES_LABEL_KEYS.testid]: "kind-smoke-01",
      [KUBERNETES_LABEL_KEYS.profile]: "spot-direct-tiny",
      [KUBERNETES_LABEL_KEYS.runClass]: "spot",
      [KUBERNETES_LABEL_KEYS.surface]: "k8s-direct",
      [KUBERNETES_LABEL_KEYS.scenario]: "single-bulk-user",
      [KUBERNETES_LABEL_KEYS.cohort]: "baseline",
      [KUBERNETES_LABEL_KEYS.jobProfile]: "tiny",
      [KUBERNETES_LABEL_KEYS.userBucket]: "bucket-0",
    });
  });

  test("uses the same testid selector shape for visibility and cleanup checks", () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      TESTID: "kind-smoke",
    });

    expect(testidSelector(config)).toBe("perfpulse.opencadc.org/testid=kind-smoke");
  });
});
