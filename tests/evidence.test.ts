import { describe, expect, test } from "bun:test";
import { createRunEvidenceReport } from "../src/evidence";

describe("run evidence report", () => {
  test("renders a Confluence-ready Markdown note with canonical run evidence fields", () => {
    const report = createRunEvidenceReport({
      acceptedWorkCount: 1,
      cleanupResult: "succeeded",
      completedWorkCount: 1,
      dashboardLinks: [
        {
          label: "PerfPulse overview",
          url: "https://grafana.example.test/d/perfpulse?var-testid=spot-20260501-180000",
        },
      ],
      executor: "shared-iterations",
      gitSha: "abc1234",
      profile: "spot-direct-tiny",
      prometheusLinks: [
        {
          label: "submitted jobs",
          url: "https://prometheus.example.test/graph?g0.expr=perfpulse_jobs_submitted%7Btestid%3D%22spot-20260501-180000%22%7D",
        },
      ],
      runClass: "spot",
      runnerImage: "ghcr.io/opencadc/perfpulse:v1",
      scenario: "single-bulk-user",
      surface: "k8s-direct",
      targetNamespaces: ["canfar-perfpulse", "canfar-workloads"],
      testid: "spot-20260501-180000",
      thresholdsUsed: [
        "perfpulse_jobs_submission_failed count==0",
        "perfpulse_jobs_visibility_failed count==0",
      ],
      visibleWorkCount: 1,
      workloadModel: "closed",
    });

    expect(report).toContain("# PerfPulse Run Evidence: spot-20260501-180000");
    expect(report).toContain("| testid | spot-20260501-180000 |");
    expect(report).toContain("| git SHA | abc1234 |");
    expect(report).toContain("| profile | spot-direct-tiny |");
    expect(report).toContain("| surface | k8s-direct |");
    expect(report).toContain("| scenario | single-bulk-user |");
    expect(report).toContain("| executor | shared-iterations |");
    expect(report).toContain("| workload model | closed |");
    expect(report).toContain("| runner image | ghcr.io/opencadc/perfpulse:v1 |");
    expect(report).toContain("| target namespaces | canfar-perfpulse, canfar-workloads |");
    expect(report).toContain("| accepted work count | 1 |");
    expect(report).toContain("| visible work count | 1 |");
    expect(report).toContain("| completed work count | 1 |");
    expect(report).toContain("| cleanup result | succeeded |");
    expect(report).toContain("- `perfpulse_jobs_submission_failed count==0`");
    expect(report).toContain(
      "- [PerfPulse overview](https://grafana.example.test/d/perfpulse?var-testid=spot-20260501-180000)",
    );
    expect(report).toContain(
      "- [submitted jobs](https://prometheus.example.test/graph?g0.expr=perfpulse_jobs_submitted%7Btestid%3D%22spot-20260501-180000%22%7D)",
    );
  });

  test("requires an active hypothesis for benchmark and stress run notes", () => {
    const benchmarkInput = {
      acceptedWorkCount: 100,
      cleanupResult: "succeeded" as const,
      completedWorkCount: 95,
      executor: "constant-arrival-rate",
      imageTag: "ghcr.io/opencadc/perfpulse:v1",
      profile: "benchmark-direct-small",
      runClass: "benchmark" as const,
      runnerImage: "ghcr.io/opencadc/perfpulse:v1",
      scenario: "many-logical-users",
      surface: "k8s-direct",
      targetNamespaces: ["canfar-workloads"],
      testid: "benchmark-20260501-180000",
      thresholdsUsed: ["http_req_failed rate<0.01"],
      visibleWorkCount: 100,
      workloadModel: "open" as const,
    };

    expect(() => createRunEvidenceReport(benchmarkInput)).toThrow(
      "benchmark run evidence requires activeHypothesis",
    );
    expect(() =>
      createRunEvidenceReport({
        ...benchmarkInput,
        activeHypothesis:
          "If API-server pressure is the bottleneck, increasing create rate should increase API latency.",
      }),
    ).not.toThrow();
    expect(() =>
      createRunEvidenceReport({
        ...benchmarkInput,
        runClass: "spot",
      }),
    ).not.toThrow();
  });

  test("rejects sensitive values without echoing the secret", () => {
    const secret = "Bearer skaha-token-abc123";
    const input = {
      acceptedWorkCount: 1,
      cleanupResult: "succeeded" as const,
      completedWorkCount: 1,
      executor: "shared-iterations",
      imageTag: "ghcr.io/opencadc/perfpulse:v1",
      profile: "spot-direct-tiny",
      runClass: "spot" as const,
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

  test("requires either a git SHA or image tag for run provenance", () => {
    expect(() =>
      createRunEvidenceReport({
        acceptedWorkCount: 1,
        cleanupResult: "succeeded",
        completedWorkCount: 1,
        executor: "shared-iterations",
        profile: "spot-direct-tiny",
        runClass: "spot",
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
      imageTag: "ghcr.io/opencadc/perfpulse:v1",
      profile: "spot-kueue-tiny",
      runClass: "spot",
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
