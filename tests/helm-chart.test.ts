import { describe, expect, test } from "bun:test";

const repoRoot = new URL("..", import.meta.url).pathname;

describe("PerfPulse Helm charts", () => {
  test("cron chart renders one non-overlapping 30-minute CronJob per default surface", () => {
    const manifest = helmTemplate("cron", [
      "--set",
      "image.tag=2026.05.04",
      "--set",
      "kubectl.image=docker.io/bitnami/kubectl:latest",
    ]);

    expect(manifest).toContain("kind: CronJob");
    expect(manifest).toContain('image: "docker.io/bitnami/kubectl:latest"');
    expect(manifest).not.toContain("bitnami/kubectl:1.31");
    expect(manifest).toContain("name: perfpulse-cron-direct");
    expect(manifest).toContain("name: perfpulse-cron-kueue");
    expect(manifest).toContain("name: perfpulse-cron-skaha");
    expect(count(manifest, "kind: CronJob")).toBe(3);
    expect(manifest).toContain('schedule: "*/30 * * * *"');
    expect(manifest).toContain("concurrencyPolicy: Forbid");
    expect(manifest).toContain("activeDeadlineSeconds: 1260");
    expect(manifest).toContain("PROFILE: cron");
    expect(manifest).toContain("RUN_CLASS: cron");
    expect(manifest).toContain('WORKLOAD_DURATION_SECONDS: "60"');
    expect(manifest).toContain('VISIBILITY_GATE_SECONDS: "600"');
    expect(manifest).not.toContain("OBSERVE_SECONDS");
    expect(manifest).toContain("kind: TestRun");
    expect(manifest).toContain("secretName: perfpulse-skaha-auth");
    expect(manifest).toContain("secretRef:");
    expect(manifest).toContain("name: perfpulse-otlp-credentials");
    expect(manifest).toContain("kind: Role");
    expect(manifest).toContain("perfpulse-workload-writer");
    expect(manifest).toContain("perfpulse-testrun-writer");
    expect(manifest).toContain("runAsNonRoot: true");
    expect(manifest).toContain("allowPrivilegeEscalation: false");
    expect(manifest).not.toContain("name: canfar-workloads\n");
    expect(manifest).not.toContain("kind: Secret");
  });

  test("campaign chart renders manual TestRuns for all default surfaces with required sizing", () => {
    const manifest = helmTemplate("campaign", [
      "--set",
      "image.tag=2026.05.04",
      "--set",
      "campaign.totalJobs=12",
      "--set",
      "campaign.logicalUsers=3",
      "--set",
      "campaign.testid=manual-20260507",
      "--set",
      "campaign.visibilityGateSeconds=120",
      "--set",
      "campaign.completionGateSeconds=300",
      "--set",
      "skaha.apiUrl=https://ws.example/skaha/v1",
    ]);

    expect(count(manifest, "kind: TestRun")).toBe(3);
    expect(manifest).toContain("name: perfpulse-campaign-direct");
    expect(manifest).toContain("name: perfpulse-campaign-kueue");
    expect(manifest).toContain("name: perfpulse-campaign-skaha");
    expect(manifest).toContain('PROFILE: "campaign"');
    expect(manifest).toContain("RUN_CLASS: campaign");
    expect(manifest).toContain("CAMPAIGN_TYPE: benchmark");
    expect(manifest).toContain('TOTAL_JOBS: "12"');
    expect(manifest).toContain('LOGICAL_USERS: "3"');
    expect(manifest).toContain('VISIBILITY_GATE_SECONDS: "120"');
    expect(manifest).toContain('COMPLETION_GATE_SECONDS: "300"');
    expect(manifest).toContain('SKAHA_API_URL: "https://ws.example/skaha/v1"');
    expect(manifest).toContain('value: "manual-20260507"');
    expect(manifest).toContain("secretName: perfpulse-skaha-auth");
    expect(manifest).toContain("name: perfpulse-otlp-credentials");
    expect(manifest).toContain("perfpulse-workload-writer");
    expect(manifest).toContain("runAsNonRoot: true");
    expect(manifest).toContain("allowPrivilegeEscalation: false");
    expect(manifest).not.toContain("kind: CronJob");
    expect(manifest).not.toContain("kind: Secret");
  });

  test("campaign chart allows selecting one surface and overriding credential secret names", () => {
    const manifest = helmTemplate("campaign", [
      "--set-json",
      'surfaces=["skaha"]',
      "--set",
      "campaign.totalJobs=4",
      "--set",
      "campaign.logicalUsers=2",
      "--set",
      "otlp.credentialsSecretName=otlp-custom",
      "--set",
      "skaha.credentialsSecretName=skaha-custom",
      "--set",
      "campaign.type=stress",
      "--set",
      "campaign.confirmStress=true",
      "--set",
      "campaign.confirmHighUsers=true",
    ]);

    expect(count(manifest, "kind: TestRun")).toBe(1);
    expect(manifest).toContain("name: perfpulse-campaign-skaha");
    expect(manifest).not.toContain("name: perfpulse-campaign-direct");
    expect(manifest).not.toContain("name: perfpulse-campaign-kueue");
    expect(manifest).toContain("name: otlp-custom");
    expect(manifest).toContain("secretName: skaha-custom");
    expect(manifest).toContain("CAMPAIGN_TYPE: stress");
    expect(manifest).toContain('CONFIRM_STRESS: "true"');
  });

  test("campaign chart requires sizing and rejects unsafe gates", () => {
    expect(expectHelmTemplateFailure("campaign", [])).toContain("campaign.totalJobs is required");
    expect(
      expectHelmTemplateFailure("campaign", [
        "--set",
        "campaign.totalJobs=1",
        "--set",
        "campaign.logicalUsers=1",
        "--set",
        "campaign.visibilityGateSeconds=300",
        "--set",
        "campaign.completionGateSeconds=60",
      ]),
    ).toContain(
      "campaign.completionGateSeconds must be greater than or equal to campaign.visibilityGateSeconds",
    );
    expect(
      expectHelmTemplateFailure("campaign", [
        "--set",
        "campaign.totalJobs=1",
        "--set",
        "campaign.logicalUsers=1",
        "--set",
        "campaign.type=stress",
      ]),
    ).toContain("stress campaigns require campaign.confirmStress=true");
    expect(
      expectHelmTemplateFailure("campaign", [
        "--set",
        "campaign.totalJobs=13",
        "--set",
        "campaign.logicalUsers=3",
      ]),
    ).toContain("campaign.totalJobs must divide evenly across campaign.logicalUsers");
    expect(
      expectHelmTemplateFailure("campaign", [
        "--set",
        "campaign.totalJobs=260",
        "--set",
        "campaign.logicalUsers=26",
      ]),
    ).toContain("campaign.logicalUsers above 25 require campaign.confirmHighUsers=true");
    expect(
      expectHelmTemplateFailure("campaign", [
        "--set",
        "campaign.totalJobs=10001",
        "--set",
        "campaign.logicalUsers=1",
      ]),
    ).toContain("campaign.totalJobs above 10000 requires campaign.type=stress");
  });
});

function helmTemplate(chartName: "campaign" | "cron", args: string[] = []): string {
  const result = Bun.spawnSync({
    cmd: ["helm", "template", chartName, `${repoRoot}charts/${chartName}`, ...args],
    stderr: "pipe",
    stdout: "pipe",
  });
  if (!result.success) {
    throw new Error(result.stderr.toString());
  }
  return result.stdout.toString();
}

function expectHelmTemplateFailure(chartName: "campaign" | "cron", args: string[]): string {
  const result = Bun.spawnSync({
    cmd: ["helm", "template", chartName, `${repoRoot}charts/${chartName}`, ...args],
    stderr: "pipe",
    stdout: "pipe",
  });
  if (result.success) {
    throw new Error("Expected helm template to fail");
  }
  return result.stderr.toString();
}

function count(value: string, needle: string): number {
  return value.split(needle).length - 1;
}
