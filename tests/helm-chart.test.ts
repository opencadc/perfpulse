import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolveRunConfig } from "../src/config";

const repoRoot = new URL("..", import.meta.url).pathname;
const cronValues = readFileSync("charts/cron/values.yaml", "utf8");
const dockerfile = readFileSync("Dockerfile", "utf8");
const helmTestTimeoutMs = 30_000;

describe("PerfPulse Helm charts", () => {
  test("runtime image includes every binary required by k6 operator pods", () => {
    expect(dockerfile).toMatch(/^FROM alpine:3\.\d+$/m);
    expect(dockerfile).toContain("COPY --from=k6 /usr/bin/k6 /usr/bin/k6");
    expect(dockerfile).toMatch(/apk add --no-cache .*ca-certificates.*curl.*kubectl.*stress-ng/u);
  });

  test(
    "cron chart renders one non-overlapping 5-minute CronJob per default surface",
    () => {
      const manifest = helmTemplate("cron", ["--set", "image.tag=2026.05.04"]);

      expect(manifest).toContain("kind: CronJob");
      expect(manifest).not.toContain("kind: Namespace");
      expect(manifest).toContain('image: "images.opencadc.org/platform/perfpulse:2026.05.04"');
      expect(manifest).not.toContain("docker.io/bitnami/kubectl");
      expect(manifest).not.toContain("bitnami/kubectl");
      expect(manifest).not.toContain("docker.io/alexeiled/stress-ng");
      expect(manifest).toContain("name: perfpulse-cron-direct");
      expect(manifest).toContain("name: perfpulse-cron-kueue");
      expect(manifest).toContain("name: perfpulse-cron-skaha");
      expect(count(manifest, 'image: "images.opencadc.org/platform/perfpulse:2026.05.04"')).toBe(
        12,
      );
      expect(count(manifest, "kind: CronJob")).toBe(3);
      expect(manifest).toContain('schedule: "*/5 * * * *"');
      expect(manifest).toContain("concurrencyPolicy: Forbid");
      expect(manifest).toContain("activeDeadlineSeconds: 87060");
      expect(manifest).toContain('COMPLETION_TIMEOUT_SECONDS: "86400"');
      expect(manifest).toContain('POLL_JITTER_MAX_MS: "1000"');
      expect(manifest).toContain('SUBMISSION_JITTER_MAX_MS: "1000"');
      expect(manifest).toContain("PROFILE: cron");
      expect(manifest).toContain("RUN_CLASS: cron");
      expect(manifest).toContain("WORKLOAD_COMMAND: '[\"stress-ng\"]'");
      expect(manifest).not.toContain("WORKLOAD_DURATION_SECONDS:");
      expect(manifest).toContain('"--timeout","60s"');
      expect(
        count(manifest, 'WORKLOAD_IMAGE: "images.opencadc.org/platform/perfpulse:2026.05.04"'),
      ).toBe(2);
      expect(count(manifest, 'WORKLOAD_IMAGE: "images.canfar.net/skaha/stress-ng:latest"')).toBe(1);
      expect(manifest).toContain('VISIBILITY_GATE_SECONDS: "600"');
      expect(manifest).toContain("K6_OTEL_EXPORT_INTERVAL: 5s");
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
      expect(manifest).toContain("cron-runner-gate");
      expect(manifest).toContain("Skipping TestRun for surface");
      expect(manifest).toContain("K6_OTEL_SERVICE_NAME");
      expect(manifest).toContain("value: perfpulse-${TESTID}");
      expect(manifest).not.toContain("name: perfpulse-workload-writer");
      expect(manifest).toContain("runAsNonRoot: true");
      expect(manifest).toContain("allowPrivilegeEscalation: false");
      expect(cronValues).not.toContain("kubectl:");
      expect(cronValues).not.toContain("bitnami/kubectl");
      expect(manifest).not.toContain("name: canfar-workloads\n");
      expect(manifest).not.toContain("kind: Secret");
      expect(manifest).not.toContain("CONFIRM_SEQUENTIAL:");
    },
    { timeout: helmTestTimeoutMs },
  );

  test("campaign chart keeps the fixed 60 second workload runtime regardless of values overrides", () => {
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
      "workload.durationSeconds=30",
    ]);

    expect(manifest).not.toContain("WORKLOAD_DURATION_SECONDS:");
    expect(manifest).toContain('"--timeout","60s"');
    expect(manifest).not.toContain('"--timeout","30s"');
  });

  test("cron chart emitted env resolves through RunConfig without removed tuning keys", () => {
    const manifest = helmTemplate("cron", ["--set", "image.tag=2026.05.04"]);

    expect(manifest).not.toContain("WORKLOAD_DURATION_SECONDS:");

    const config = resolveRunConfig({
      COMPLETION_TIMEOUT_SECONDS: "86400",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      PROFILE: "cron",
      RUN_CLASS: "cron",
      SURFACE: "k8s-direct",
      TESTID: "cron-direct",
      VISIBILITY_GATE_SECONDS: "600",
      WORKLOAD_COMMAND: '["stress-ng"]',
      WORKLOAD_ARGS: '["--cpu","1","--temp-path","/tmp","--timeout","60s","--metrics-brief"]',
      WORKLOAD_IMAGE: "images.opencadc.org/platform/perfpulse:2026.05.04",
      WORKLOAD_NAMESPACE: "canfar-workloads",
    });

    expect(config.workload.durationSeconds).toBe(60);
  });

  test("cron chart keeps the fixed 60 second workload runtime regardless of values overrides", () => {
    const manifest = helmTemplate("cron", [
      "--set",
      "image.tag=2026.05.04",
      "--set",
      "testDurationSeconds=30",
    ]);

    expect(manifest).not.toContain("WORKLOAD_DURATION_SECONDS:");
    expect(manifest).toContain('"--timeout","60s"');
    expect(manifest).not.toContain('"--timeout","30s"');
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
      "campaign.completionTimeoutSeconds=300",
      "--set",
      "skaha.apiUrl=https://ws.example/skaha/v1",
    ]);

    expect(count(manifest, "kind: TestRun")).toBe(3);
    expect(manifest).not.toContain("kind: Namespace");
    expect(count(manifest, 'image: "images.opencadc.org/platform/perfpulse:2026.05.04"')).toBe(9);
    expect(manifest).not.toContain("docker.io/bitnami/kubectl");
    expect(manifest).not.toContain("docker.io/alexeiled/stress-ng");
    expect(manifest).toContain("name: campaign-direct");
    expect(manifest).toContain("name: campaign-direct-config");
    expect(manifest).toContain("name: campaign-kueue");
    expect(manifest).toContain("name: campaign-kueue-config");
    expect(manifest).toContain("name: campaign-skaha");
    expect(manifest).toContain("name: campaign-skaha-config");
    expect(manifest).toContain('PROFILE: "campaign"');
    expect(manifest).toContain("RUN_CLASS: campaign");
    expect(manifest).toContain("CAMPAIGN_TYPE: benchmark");
    expect(manifest).toContain('TOTAL_JOBS: "12"');
    expect(manifest).toContain('LOGICAL_USERS: "3"');
    expect(manifest).toContain("WORKLOAD_COMMAND: '[\"stress-ng\"]'");
    expect(
      count(manifest, 'WORKLOAD_IMAGE: "images.opencadc.org/platform/perfpulse:2026.05.04"'),
    ).toBe(2);
    expect(count(manifest, 'WORKLOAD_IMAGE: "images.canfar.net/skaha/stress-ng:latest"')).toBe(1);
    expect(manifest).toContain('VISIBILITY_GATE_SECONDS: "120"');
    expect(manifest).toContain('COMPLETION_TIMEOUT_SECONDS: "300"');
    expect(manifest).toContain('POLL_JITTER_MAX_MS: "1000"');
    expect(manifest).toContain('SUBMISSION_JITTER_MAX_MS: "1000"');
    expect(manifest).toContain('SKAHA_API_URL: "https://ws.example/skaha/v1"');
    expect(manifest).toContain('value: "manual-20260507"');
    expect(manifest).toContain('value: "perfpulse-manual-20260507"');
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
    expect(manifest).not.toContain("CONFIRM_SEQUENTIAL:");
    expect(count(manifest, 'JOBS_PER_VU_CAP: "500"')).toBe(3);
    expect(count(manifest, 'SKAHA_BULK_POLL_MIN_SECONDS: "15"')).toBe(1);
    expect(count(manifest, 'SKAHA_BULK_POLL_CYCLE_SECONDS: "1"')).toBe(1);
  });

  test("campaign chart exposes jobs-per-VU cap and bulk Skaha poll overrides", () => {
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
      "campaign.jobsPerVuCap=250",
      "--set",
      "skaha.bulkPollMinSeconds=30",
      "--set",
      "skaha.bulkPollCycleSeconds=2",
      "--set-json",
      'surfaces=["skaha"]',
    ]);

    expect(manifest).toContain('JOBS_PER_VU_CAP: "250"');
    expect(manifest).toContain('SKAHA_BULK_POLL_MIN_SECONDS: "30"');
    expect(manifest).toContain('SKAHA_BULK_POLL_CYCLE_SECONDS: "2"');
    expect(manifest).not.toContain("CONFIRM_SEQUENTIAL:");
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
      "campaign.testid=stress-skaha-20260507",
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
    expect(manifest).toContain("name: campaign-skaha");
    expect(manifest).toContain("name: campaign-skaha-config");
    expect(manifest).not.toContain("name: campaign-direct");
    expect(manifest).not.toContain("name: campaign-kueue");
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
      "campaign.testid=sa-20260507",
      "--set",
      "serviceAccount.create=true",
      "--set",
      "serviceAccount.name=perfpulse-campaign",
    ]);

    expect(manifest).toMatch(/apiVersion: v1\nkind: ServiceAccount/u);
    expect(manifest).toContain("name: perfpulse-campaign");
    expect(manifest).toContain("serviceAccountName: perfpulse-campaign");
  });

  test("campaign chart scopes surface resources to the Helm release name", () => {
    const benchmarkManifest = helmTemplateWithRelease("perfpulse-benchmark", "campaign", [
      "--set-json",
      'surfaces=["skaha"]',
      "--set",
      "campaign.totalJobs=10",
      "--set",
      "campaign.logicalUsers=5",
      "--set",
      "campaign.testid=benchmark-skaha-20260507",
    ]);
    const skahaManifest = helmTemplateWithRelease("perfpulse-skaha", "campaign", [
      "--set-json",
      'surfaces=["skaha"]',
      "--set",
      "campaign.totalJobs=10",
      "--set",
      "campaign.logicalUsers=5",
      "--set",
      "campaign.testid=skaha-20260507",
    ]);

    expect(benchmarkManifest).toContain("name: perfpulse-benchmark-skaha");
    expect(benchmarkManifest).toContain("name: perfpulse-benchmark-skaha-config");
    expect(benchmarkManifest).toContain("name: perfpulse-benchmark-workload-writer");
    expect(benchmarkManifest).not.toContain("perfpulse-campaign-skaha-config");
    expect(skahaManifest).toContain("name: perfpulse-skaha-skaha");
    expect(skahaManifest).toContain("name: perfpulse-skaha-skaha-config");
    expect(skahaManifest).toContain("name: perfpulse-skaha-workload-writer");
    expect(skahaManifest).not.toContain("perfpulse-campaign-skaha-config");
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
        "campaign.testid=manual-20260507",
        "--set",
        "campaign.visibilityGateSeconds=300",
        "--set",
        "campaign.completionTimeoutSeconds=60",
      ]),
    ).toContain(
      "campaign.completionTimeoutSeconds must be greater than or equal to campaign.visibilityGateSeconds",
    );
    expect(
      expectHelmTemplateFailure("campaign", [
        "--set",
        "campaign.totalJobs=1",
        "--set",
        "campaign.logicalUsers=1",
      ]),
    ).toContain("campaign.testid is required");
    expect(
      expectHelmTemplateFailure("campaign", [
        "--set",
        "campaign.totalJobs=1",
        "--set",
        "campaign.logicalUsers=1",
        "--set",
        "campaign.testid=stress-20260507",
        "--set",
        "campaign.type=stress",
      ]),
    ).toContain("stress campaigns require campaign.confirmStress=true");
    expect(
      expectHelmTemplateFailure("campaign", [
        "--set",
        "campaign.totalJobs=1",
        "--set",
        "campaign.logicalUsers=1",
        "--set",
        "campaign.testid=manual-20260507",
        "--set",
        "campaign.completionGateSeconds=60",
      ]),
    ).toContain(
      "campaign.completionGateSeconds has been replaced by campaign.completionTimeoutSeconds",
    );
    expect(
      expectHelmTemplateFailure("campaign", [
        "--set",
        "campaign.totalJobs=260",
        "--set",
        "campaign.logicalUsers=26",
        "--set",
        "campaign.testid=manual-20260507",
      ]),
    ).toContain("campaign.logicalUsers above 25 require campaign.confirmHighUsers=true");
    expect(
      expectHelmTemplateFailure("campaign", [
        "--set",
        "campaign.totalJobs=10001",
        "--set",
        "campaign.logicalUsers=1",
        "--set",
        "campaign.testid=manual-20260507",
      ]),
    ).toContain("campaign.totalJobs above 10000 requires campaign.type=stress");
  });
});

function helmTemplate(chartName: "campaign" | "cron", args: string[] = []): string {
  return helmTemplateWithRelease(chartName, chartName, args);
}

function helmTemplateWithRelease(
  releaseName: string,
  chartName: "campaign" | "cron",
  args: string[] = [],
): string {
  const result = Bun.spawnSync({
    cmd: ["helm", "template", releaseName, `${repoRoot}charts/${chartName}`, ...args],
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
