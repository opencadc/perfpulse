import type { RunConfig } from "./config";

export const KUBERNETES_LABEL_KEYS = {
  appName: "app.kubernetes.io/name",
  managedBy: "app.kubernetes.io/managed-by",
  runClass: "perfpulse.opencadc.org/run-class",
  scenario: "perfpulse.opencadc.org/scenario",
  surface: "perfpulse.opencadc.org/surface",
  testid: "perfpulse.opencadc.org/testid",
  userBucket: "perfpulse.opencadc.org/user-bucket",
} as const;

export function workloadLabels(
  config: RunConfig,
  userBucket = config.userBucket,
): Record<string, string> {
  return {
    [KUBERNETES_LABEL_KEYS.appName]: "perfpulse",
    [KUBERNETES_LABEL_KEYS.managedBy]: "k6",
    [KUBERNETES_LABEL_KEYS.testid]: config.testid,
    [KUBERNETES_LABEL_KEYS.runClass]: config.runClass,
    [KUBERNETES_LABEL_KEYS.surface]: config.surface,
    [KUBERNETES_LABEL_KEYS.scenario]: config.scenario,
    [KUBERNETES_LABEL_KEYS.userBucket]: userBucket,
  };
}

export function testidSelector(config: RunConfig): string {
  return `${KUBERNETES_LABEL_KEYS.testid}=${config.testid}`;
}
