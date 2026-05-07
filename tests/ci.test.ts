import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
const kindWorkflow = readFileSync(".github/workflows/kind-smoke.yml", "utf8");

describe("CI workflow contract", () => {
  test("installs with bun ci before explicit quality gates", () => {
    expect(packageJson.scripts.ci).toBe("bun install --frozen-lockfile");
    expect(ciWorkflow).toContain("run: bun ci");
    expect(ciWorkflow).toContain("run: bun run lint");
    expect(ciWorkflow).toContain("run: bun run typecheck");
    expect(ciWorkflow).toContain("run: bun test");
    expect(ciWorkflow).toContain("run: bun run build");
  });

  test("validates k6, Helm, and Docker release candidates without publishing", () => {
    expect(ciWorkflow).toContain("run: bun run k6:dry-run");
    expect(ciWorkflow).toContain("helm lint charts/cron");
    expect(ciWorkflow).toContain("helm lint charts/campaign");
    expect(ciWorkflow).toContain("--set campaign.totalJobs=12");
    expect(ciWorkflow).toContain("--set campaign.logicalUsers=3");
    expect(ciWorkflow).toContain("helm template perfpulse-cron charts/cron");
    expect(ciWorkflow).toContain("helm template perfpulse-campaign charts/campaign");
    expect(ciWorkflow).toContain("docker/build-push-action");
    expect(ciWorkflow).toContain("push: false");
  });

  test("keeps kind smoke as an explicit manual proof only", () => {
    expect(kindWorkflow).toContain("workflow_dispatch:");
    expect(kindWorkflow).not.toContain("pull_request:");
    expect(kindWorkflow).not.toContain("push:");
  });
});
