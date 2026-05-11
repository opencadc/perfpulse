import { describe, expect, test } from "bun:test";

describe("PerfPulse runbooks", () => {
  test("deployment runbook is a concise Helm guide for cron and campaigns", async () => {
    const runbook = await Bun.file("docs/runbooks/deployment.md").text();
    const normalizedRunbook = runbook.replace(/\s+/g, " ");

    expect(runbook).toContain("# PerfPulse Helm Runbook");
    expect(runbook).toContain("## Prerequisites");
    expect(runbook).toContain("helm upgrade --install perfpulse-cron");
    expect(runbook).toContain("## Run Cron Check Manually");
    expect(runbook).toContain(
      'kubectl create job "perfpulse-cron-$' + "{SURFACE}-manual-$" + '{RUN_ID}"',
    );
    expect(runbook).toContain('--from="cronjob/perfpulse-cron-$' + '{SURFACE}"');
    expect(runbook).toContain("Each cron surface currently has one expected job.");
    expect(runbook).toContain("perfpulse_jobs_expected");
    expect(runbook).toContain("helm upgrade --install perfpulse-benchmark");
    expect(runbook).toContain("## Select Campaign Surfaces");
    expect(runbook).toContain("run concurrently");
    expect(runbook).toContain("`campaign.totalJobs` is per selected surface");
    expect(runbook).toContain("percentage panels divide by expected jobs");
    expect(runbook).toContain("--set-json 'surfaces=[\"skaha\"]'");
    expect(runbook).toContain("--set-json 'surfaces=[\"k8s-direct\"]'");
    expect(runbook).toContain("--set-json 'surfaces=[\"k8s-kueue\"]'");
    expect(runbook).toContain("helm upgrade --install perfpulse-stress");
    expect(runbook).toContain("Release Please maintains the default chart image tags.");
    expect(runbook).toContain("--set campaign.type=benchmark");
    expect(runbook).toContain("--set campaign.totalJobs=1000");
    expect(runbook).toContain("--set campaign.logicalUsers=100");
    expect(runbook).toContain("--set campaign.confirmHighUsers=true");
    expect(runbook).toContain("--set campaign.type=stress");
    expect(runbook).toContain("--set campaign.confirmStress=true");
    expect(runbook).not.toContain("--set campaignType=");
    expect(runbook).not.toContain("--set totalJobs=");
    expect(runbook).not.toContain("--set logicalUsers=");
    expect(runbook).toContain("helm uninstall perfpulse-benchmark");
    expect(runbook).toContain("Completion is evidence, not the success gate.");
    expect(runbook).toContain("Dashboard evidence");
    expect(runbook).toContain("Expected Jobs");
    expect(normalizedRunbook).toContain("Target State Reached");
    expect(runbook).toContain("k6_data_sent_bytes_total");
    expect(runbook).toContain("k6_data_received_bytes_total");
    expect(runbook).not.toContain("kubectl apply -f docs/manifests");
    expect(runbook).not.toContain("--set image.repository=");
    expect(runbook).not.toContain("--set image.tag=");
  });

  test("documented campaign values render with Helm", () => {
    expectHelmTemplate([
      "perfpulse-benchmark",
      "./charts/campaign",
      "--namespace",
      "canfar-perfpulse",
      "--set",
      "campaign.type=benchmark",
      "--set",
      "campaign.totalJobs=1000",
      "--set",
      "campaign.logicalUsers=100",
      "--set",
      "campaign.confirmHighUsers=true",
    ]);
    expectHelmTemplate([
      "perfpulse-stress",
      "./charts/campaign",
      "--namespace",
      "canfar-perfpulse",
      "--set",
      "campaign.type=stress",
      "--set",
      "campaign.totalJobs=10000",
      "--set",
      "campaign.logicalUsers=100",
      "--set",
      "campaign.confirmHighUsers=true",
      "--set",
      "campaign.confirmStress=true",
    ]);
  });
});

function expectHelmTemplate(args: string[]): void {
  const result = Bun.spawnSync({
    cmd: ["helm", "template", ...args],
    stderr: "pipe",
    stdout: "pipe",
  });
  if (!result.success) {
    throw new Error(result.stderr.toString());
  }
}
