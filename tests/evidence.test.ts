import { describe, expect, test } from "bun:test";
import { createRunEvidenceReport } from "../src/evidence";

describe("run evidence report", () => {
  test("renders a Confluence-ready Markdown note with canonical run evidence fields", () => {
    const report = createRunEvidenceReport({
      acceptedWorkCount: 1,
      artifactLinks: [
        {
          label: "raw run archive",
          url: "https://artifacts.example.test/perfpulse/cron-20260501-180000.tar.gz",
        },
      ],
      cleanupResult: "succeeded",
      completedWorkCount: 1,
      dashboardLinks: [
        {
          label: "PerfPulse overview",
          url: "https://grafana.example.test/d/perfpulse?var-testid=cron-20260501-180000",
        },
      ],
      executor: "shared-iterations",
      expectedWorkCount: 1,
      gitSha: "abc1234",
      profile: "cron",
      prometheusLinks: [
        {
          label: "expected jobs",
          url: "https://prometheus.example.test/graph?g0.expr=perfpulse_jobs_expected%7Btestid%3D%22cron-20260501-180000%22%7D",
        },
      ],
      runClass: "cron",
      runnerImage: "ghcr.io/opencadc/perfpulse:v1",
      scenario: "single-bulk-user",
      surface: "k8s-direct",
      targetNamespaces: ["canfar-perfpulse", "canfar-workloads"],
      testid: "cron-20260501-180000",
      thresholdsUsed: [
        "perfpulse_jobs_submission_failed count==0",
        "perfpulse_jobs_visibility_failed count==0",
      ],
      visibleWorkCount: 1,
      workloadModel: "closed",
    });

    expect(report).toContain("# PerfPulse Run Evidence: cron-20260501-180000");
    expect(report).toContain("| testid | cron-20260501-180000 |");
    expect(report).toContain("| git SHA | abc1234 |");
    expect(report).toContain("| profile | cron |");
    expect(report).toContain("| surface | k8s-direct |");
    expect(report).toContain("| scenario | single-bulk-user |");
    expect(report).toContain("| executor | shared-iterations |");
    expect(report).toContain("| workload model | closed |");
    expect(report).toContain("| run class | cron |");
    expect(report).toContain("| runner image | ghcr.io/opencadc/perfpulse:v1 |");
    expect(report).toContain("| target namespaces | canfar-perfpulse, canfar-workloads |");
    expect(report).toContain("| expected work count | 1 |");
    expect(report).toContain("| accepted work count | 1 |");
    expect(report).toContain("| visible work count | 1 |");
    expect(report).toContain("| completed work count | 1 |");
    expect(report).toContain("| cleanup result | succeeded |");
    expect(report).toContain("- `perfpulse_jobs_submission_failed count==0`");
    expect(report).toContain(
      "- [PerfPulse overview](https://grafana.example.test/d/perfpulse?var-testid=cron-20260501-180000)",
    );
    expect(report).toContain(
      "- [expected jobs](https://prometheus.example.test/graph?g0.expr=perfpulse_jobs_expected%7Btestid%3D%22cron-20260501-180000%22%7D)",
    );
    expect(report).toContain("## Artifacts");
    expect(report).toContain(
      "- [raw run archive](https://artifacts.example.test/perfpulse/cron-20260501-180000.tar.gz)",
    );
  });

  test("requires campaign type and active hypothesis for campaign run notes", () => {
    const campaignInput = {
      acceptedWorkCount: 100,
      campaignType: "benchmark" as const,
      cleanupResult: "succeeded" as const,
      completedWorkCount: 95,
      executor: "shared-iterations",
      expectedWorkCount: 100,
      imageTag: "ghcr.io/opencadc/perfpulse:v1",
      profile: "campaign",
      runClass: "campaign" as const,
      runnerImage: "ghcr.io/opencadc/perfpulse:v1",
      scenario: "many-logical-users",
      surface: "k8s-direct",
      targetNamespaces: ["canfar-workloads"],
      testid: "benchmark-20260501-180000",
      thresholdsUsed: ["http_req_failed rate<0.01"],
      visibleWorkCount: 100,
      workloadModel: "open" as const,
    };

    expect(() => createRunEvidenceReport(campaignInput)).toThrow(
      "campaign run evidence requires activeHypothesis",
    );
    expect(() =>
      createRunEvidenceReport({
        ...campaignInput,
        activeHypothesis:
          "If API-server pressure is the bottleneck, increasing create rate should increase API latency.",
      }),
    ).not.toThrow();
    expect(() =>
      createRunEvidenceReport({
        ...omitCampaignType(campaignInput),
        activeHypothesis:
          "If API-server pressure is the bottleneck, increasing create rate should increase API latency.",
      }),
    ).toThrow("campaign run evidence requires campaignType");
    expect(() =>
      createRunEvidenceReport({
        ...campaignInput,
        activeHypothesis:
          "If API-server pressure is the bottleneck, increasing create rate should increase API latency.",
        runClass: "cron",
      }),
    ).toThrow("cron run evidence must not include campaignType");
  });

  test("rejects sensitive values without echoing the secret", () => {
    const secret = "Bearer skaha-token-abc123";
    const input = {
      acceptedWorkCount: 1,
      cleanupResult: "succeeded" as const,
      completedWorkCount: 1,
      executor: "shared-iterations",
      expectedWorkCount: 1,
      imageTag: "ghcr.io/opencadc/perfpulse:v1",
      profile: "cron",
      runClass: "cron" as const,
      runnerImage: "ghcr.io/opencadc/perfpulse:v1",
      scenario: "single-bulk-user",
      surface: "k8s-direct",
      targetNamespaces: ["canfar-workloads"],
      testid: "spot-20260501-180000",
      thresholdsUsed: [secret],
      visibleWorkCount: 1,
      workloadModel: "closed" as const,
    };

    expect(() => createRunEvidenceReport(input)).toThrow("run evidence contains a sensitive value");
    try {
      createRunEvidenceReport(input);
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  test("rejects sensitive values in artifact links without echoing the secret", () => {
    const secret = "https://artifacts.example.test/perfpulse?token=abc123";
    const input = {
      acceptedWorkCount: 1,
      artifactLinks: [
        {
          label: "raw run archive",
          url: secret,
        },
      ],
      cleanupResult: "succeeded" as const,
      completedWorkCount: 1,
      executor: "shared-iterations",
      expectedWorkCount: 1,
      imageTag: "ghcr.io/opencadc/perfpulse:v1",
      profile: "cron",
      runClass: "cron" as const,
      runnerImage: "ghcr.io/opencadc/perfpulse:v1",
      scenario: "single-bulk-user",
      surface: "k8s-direct",
      targetNamespaces: ["canfar-workloads"],
      testid: "spot-20260501-180000",
      thresholdsUsed: ["http_req_failed rate<0.01"],
      visibleWorkCount: 1,
      workloadModel: "closed" as const,
    };

    expect(() => createRunEvidenceReport(input)).toThrow("run evidence contains a sensitive value");
    try {
      createRunEvidenceReport(input);
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  test("requires either a git SHA or image tag for run provenance", () => {
    expect(() =>
      createRunEvidenceReport({
        acceptedWorkCount: 1,
        cleanupResult: "succeeded",
        completedWorkCount: 1,
        executor: "shared-iterations",
        expectedWorkCount: 1,
        profile: "cron",
        runClass: "cron",
        runnerImage: "ghcr.io/opencadc/perfpulse:v1",
        scenario: "single-bulk-user",
        surface: "k8s-direct",
        targetNamespaces: ["canfar-workloads"],
        testid: "spot-20260501-180000",
        thresholdsUsed: ["http_req_failed rate<0.01"],
        visibleWorkCount: 1,
        workloadModel: "closed",
      }),
    ).toThrow("run evidence requires gitSha or imageTag");
  });

  test("includes admitted Kueue Workload count only when supplied", () => {
    const report = createRunEvidenceReport({
      acceptedWorkCount: 3,
      admittedKueueWorkloadCount: 2,
      cleanupResult: "succeeded",
      completedWorkCount: 2,
      executor: "shared-iterations",
      expectedWorkCount: 3,
      imageTag: "ghcr.io/opencadc/perfpulse:v1",
      profile: "cron",
      runClass: "cron",
      runnerImage: "ghcr.io/opencadc/perfpulse:v1",
      scenario: "single-bulk-user",
      surface: "k8s-kueue",
      targetNamespaces: ["canfar-workloads"],
      testid: "spot-kueue-20260501-180000",
      thresholdsUsed: ["perfpulse_kueue_workloads_admission_failed count==0"],
      visibleWorkCount: 3,
      workloadModel: "closed",
    });

    expect(report).toContain("| admitted Kueue Workload count | 2 |");
  });
});

function omitCampaignType<T extends { campaignType: unknown }>(input: T): Omit<T, "campaignType"> {
  const { campaignType: _campaignType, ...withoutCampaignType } = input;
  void _campaignType;
  return withoutCampaignType;
}
