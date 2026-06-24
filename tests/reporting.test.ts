import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";

describe("Grafana-only reporting", () => {
  test("does not ship offline markdown report generators", () => {
    expect(existsSync("src/evidence.ts")).toBe(false);
    expect(existsSync("src/campaign-report.ts")).toBe(false);
    expect(existsSync("tests/evidence.test.ts")).toBe(false);
    expect(existsSync("tests/campaign-report.test.ts")).toBe(false);
  });

  test("documents Grafana dashboards as the campaign evidence surface", async () => {
    const campaignsRunbook = await Bun.file("docs/runbooks/campaigns.md").text();
    const runEvidenceRunbook = await Bun.file("docs/runbooks/run-evidence.md").text();
    const deploymentRunbook = await Bun.file("docs/runbooks/deployment.md").text();

    expect(campaignsRunbook).toContain("perfpulse.json");
    expect(campaignsRunbook).not.toContain("campaign-report");
    expect(runEvidenceRunbook).toContain("perfpulse.json");
    expect(runEvidenceRunbook).not.toContain("perfpulse-cron.json");
    expect(runEvidenceRunbook).not.toContain("perfpulse-campaign.json");
    expect(deploymentRunbook).toContain("perfpulse.json");
    expect(deploymentRunbook).toContain("run-evidence.md");
    expect(deploymentRunbook).not.toContain("PerfPulse Overview");
  });
});
