import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const repoRoot = new URL("..", import.meta.url).pathname;
const cronValues = readFileSync("charts/cron/values.yaml", "utf8");
const dockerfile = readFileSync("Dockerfile", "utf8");

describe("PerfPulse Helm charts", () => {
  test("runtime image includes every binary required by k6 operator pods and workloads", () => {
    expect(dockerfile).toContain("FROM alpine:3.22");
    expect(dockerfile).toContain("COPY --from=k6 /usr/bin/k6 /usr/bin/k6");
    expect(dockerfile).toMatch(/apk add --no-cache .*ca-certificates.*curl.*kubectl.*stress-ng/u);
  });

  test("cron chart renders one non-overlapping 5-minute CronJob per default surface", () => {
    const manifest = helmTemplate("cron", ["--set", "image.tag=2026.05.04"]);

    expect(manifest).toContain("kind: CronJob");
    expect(manifest).not.toContain("kind: Namespace");
    expect(manifest).toContain('image: "images.opencadc.org/platform/perfpulse:2026.05.04"');
    expect(manifest).not.toContain("docker.io/bitnami/kubectl");
    expect(manifest).not.toContain("bitnami/kubectl");
    expect(manifest).not.toContain("docker.io/alexeiled/stress-ng");
    expect(manifest).not.toContain("images.canfar.net/skaha/stress-ng");
    expect(manifest).toContain("name: perfpulse-cron-direct");
    expect(manifest).toContain("name: perfpulse-cron-kueue");
    expect(manifest).toContain("name: perfpulse-cron-skaha");
    expect(count(manifest, 'image: "images.opencadc.org/platform/perfpulse:2026.05.04"')).toBe(12);
    expect(count(manifest, "kind: CronJob")).toBe(3);
    expect(manifest).toContain('schedule: "*/5 * * * *"');
    expect(manifest).toContain("concurrencyPolicy: Forbid");
    expect(manifest).toContain("activeDeadlineSeconds: 1260");
    expect(manifest).toContain("PROFILE: cron");
    expect(manifest).toContain("RUN_CLASS: cron");
    expect(manifest).toContain("WORKLOAD_COMMAND: '[\"stress-ng\"]'");
    expect(manifest).toContain('WORKLOAD_DURATION_SECONDS: "60"');
    expect(manifest).toContain(
      'WORKLOAD_IMAGE: "images.opencadc.org/platform/perfpulse:2026.05.04"',
    );
    expect(manifest).toContain('VISIBILITY_GATE_SECONDS: "600"');
    expect(manifest).not.toContain("OBSERVE_SECONDS");
    expect(manifest).toContain("kind: TestRun");
    expect(manifest).toContain("secretName: perfpulse-skaha-auth");
    expect(manifest).toContain("secretRef:");
    expect(manifest).toContain("name: perfpulse-otlp-credentials");
    expect(manifest).toMatch(/apiVersion: v1\nkind: ServiceAccount/u);
    expect(manifest).toContain("name: canfar-perfpulse");
    expect(manifest).toContain("kind: Role");
    expect(manifest).toContain("cron-workload-writer");
    expect(manifest).toContain("cron-testrun-writer");
    expect(manifest).not.toContain("name: perfpulse-workload-writer");
    expect(manifest).toContain("runAsNonRoot: true");
    expect(manifest).toContain("allowPrivilegeEscalation: false");
    expect(cronValues).not.toContain("kubectl:");
    expect(cronValues).not.toContain("bitnami/kubectl");
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
    expect(manifest).not.toContain("kind: Namespace");
    expect(count(manifest, 'image: "images.opencadc.org/platform/perfpulse:2026.05.04"')).toBe(9);
    expect(manifest).not.toContain("docker.io/bitnami/kubectl");
    expect(manifest).not.toContain("docker.io/alexeiled/stress-ng");
    expect(manifest).not.toContain("images.canfar.net/skaha/stress-ng");
    expect(manifest).toContain("name: perfpulse-campaign-direct");
    expect(manifest).toContain("name: perfpulse-campaign-kueue");
    expect(manifest).toContain("name: perfpulse-campaign-skaha");
    expect(manifest).toContain('PROFILE: "campaign"');
    expect(manifest).toContain("RUN_CLASS: campaign");
    expect(manifest).toContain("CAMPAIGN_TYPE: benchmark");
    expect(manifest).toContain('TOTAL_JOBS: "12"');
    expect(manifest).toContain('LOGICAL_USERS: "3"');
    expect(manifest).toContain("WORKLOAD_COMMAND: '[\"stress-ng\"]'");
    expect(manifest).toContain(
      'WORKLOAD_IMAGE: "images.opencadc.org/platform/perfpulse:2026.05.04"',
    );
    expect(manifest).toContain('VISIBILITY_GATE_SECONDS: "120"');
    expect(manifest).toContain('COMPLETION_GATE_SECONDS: "300"');
    expect(manifest).toContain('SKAHA_API_URL: "https://ws.example/skaha/v1"');
    expect(manifest).toContain('value: "manual-20260507"');
    expect(manifest).toContain("secretName: perfpulse-skaha-auth");
    expect(manifest).toContain("name: perfpulse-otlp-credentials");
    expect(manifest).not.toMatch(/apiVersion: v1\nkind: ServiceAccount/u);
    expect(manifest).toContain("serviceAccountName: canfar-perfpulse");
    expect(manifest).toContain("campaign-workload-writer");
    expect(manifest).not.toContain("name: perfpulse-workload-writer");
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

  test("campaign chart can create a dedicated ServiceAccount when requested", () => {
    const manifest = helmTemplate("campaign", [
      "--set",
      "campaign.totalJobs=4",
      "--set",
      "campaign.logicalUsers=2",
      "--set",
      "serviceAccount.create=true",
      "--set",
      "serviceAccount.name=perfpulse-campaign",
    ]);

    expect(manifest).toMatch(/apiVersion: v1\nkind: ServiceAccount/u);
    expect(manifest).toContain("name: perfpulse-campaign");
    expect(manifest).toContain("serviceAccountName: perfpulse-campaign");
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
