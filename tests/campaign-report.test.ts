import { describe, expect, test } from "bun:test";
import { createCampaignReport, createMixedPressureProfile } from "../src/campaign-report";

describe("campaign evidence reports", () => {
  test("renders benchmark comparison evidence without promoting guessed thresholds to SLO gates", () => {
    const report = createCampaignReport({
      activeHypothesis:
        "If Kueue queue depth is the bottleneck, visibility latency should rise while create latency stays stable.",
      baselines: {
        exists: false,
        note: "Need three successful benchmark-small runs before thresholds can fail TestRuns.",
      },
      profile: "benchmark-small",
      preserveOnFailure: { enabled: false },
      runClass: "benchmark",
      surfaces: [
        {
          acceptedWork: 100,
          cleanupStatus: "succeeded",
          clusterMetrics: [
            { name: "apiserver_request_duration_seconds p95", value: "220ms" },
            { name: "kueue_pending_workloads", value: "4" },
          ],
          droppedIterations: 0,
          latency: { p50: "12s", p95: "33s", p99: "45s" },
          surface: "k8s-kueue",
          visibleWork: 98,
        },
        {
          acceptedWork: 100,
          cleanupStatus: "succeeded",
          clusterMetrics: [{ name: "apiserver_request_duration_seconds p95", value: "180ms" }],
          droppedIterations: 1,
          latency: { p50: "8s", p95: "18s", p99: "26s" },
          surface: "k8s-direct",
          visibleWork: 100,
        },
      ],
      testid: "benchmark-20260504-120000",
    });

    expect(report.runnable).toBe(true);
    expect(report.markdown).toContain("| Baselines exist | no |");
    expect(report.markdown).toContain("| k8s-kueue | 100 | 98 | 12s | 33s | 45s | 0 | succeeded |");
    expect(report.markdown).toContain(
      "| k8s-direct | 100 | 100 | 8s | 18s | 26s | 1 | succeeded |",
    );
    expect(report.markdown).toContain("- k8s-kueue: apiserver_request_duration_seconds p95=220ms");
    expect(report.markdown).toContain(
      "Benchmark thresholds are evidence only until baselines exist.",
    );
    expect(report.markdown).not.toContain("official SLO");
    expect(report.markdown).not.toContain("official SLA");
  });

  test("does not consider stress campaigns runnable without explicit profile selection and confirmation", () => {
    const report = createCampaignReport({
      activeHypothesis:
        "If API-server pressure is the bottleneck, create latency and dropped iterations should rise first.",
      confirmStress: false,
      explicitProfileSelection: false,
      preserveOnFailure: { enabled: false },
      profile: "stress-medium",
      runClass: "stress",
      stress: {
        acceptedWork: 8000,
        apiServerPressure: "elevated but observable",
        cleanupStatus: "succeeded",
        completion: { completedWork: 6000, note: "completion recorded for context only" },
        droppedIterations: 50,
        grafanaVisibility: "PerfPulse dashboard queryable by testid",
        kueueControllerHealth: "controller available; no restart increase",
        rejectionCategories: { rate_limited: 100, server_error: 0, validation: 0 },
        visibleWork: 7900,
        workloadExecution: "accepted jobs reached running or terminal states",
      },
      testid: "stress-20260504-130000",
    });

    expect(report.runnable).toBe(false);
    expect(report.blockers).toContain("stress campaigns require explicit profile selection");
    expect(report.blockers).toContain("stress campaigns require CONFIRM_STRESS=true");
    expect(report.markdown).toContain("| Runnable | no |");
  });

  test("renders stress campaign success around acceptance visibility control-plane health and cleanup", () => {
    const report = createCampaignReport({
      activeHypothesis:
        "If the k6 runner is the bottleneck, dropped iterations should rise without matching queue pressure.",
      confirmStress: true,
      explicitProfileSelection: true,
      preserveOnFailure: { enabled: false },
      profile: "stress-high",
      runClass: "stress",
      stress: {
        acceptedWork: 100000,
        apiServerPressure: "p95 create latency 900ms; no sustained 5xx increase",
        cleanupStatus: "succeeded",
        completion: {
          completedWork: 83000,
          note: "large batch still draining after evidence window",
        },
        droppedIterations: 120,
        grafanaVisibility: "dashboard panels queryable by testid and surface",
        kueueControllerHealth: "controller CPU elevated; no restart increase",
        rejectionCategories: { rate_limited: 240, server_error: 3, validation: 0 },
        visibleWork: 99500,
        workloadExecution: "visible workloads reached running, succeeded, or expected queue states",
      },
      testid: "stress-20260504-140000",
    });

    expect(report.runnable).toBe(true);
    expect(report.markdown).toContain("| Accepted work | 100000 |");
    expect(report.markdown).toContain("| Visible work | 99500 |");
    expect(report.markdown).toContain("| Dropped iterations | 120 |");
    expect(report.markdown).toContain(
      "| API-server pressure | p95 create latency 900ms; no sustained 5xx increase |",
    );
    expect(report.markdown).toContain(
      "| Kueue controller health | controller CPU elevated; no restart increase |",
    );
    expect(report.markdown).toContain(
      "| Workload execution | visible workloads reached running, succeeded, or expected queue states |",
    );
    expect(report.markdown).toContain(
      "| Grafana visibility | dashboard panels queryable by testid and surface |",
    );
    expect(report.markdown).toContain("| Cleanup status | succeeded |");
    expect(report.markdown).toContain("- rate_limited: 240");
    expect(report.markdown).toContain("## Completion (Secondary)");
    expect(report.markdown).toContain("| Completed work | 83000 |");
  });

  test("requires testid profile and surface labels when preserve-on-failure is enabled", () => {
    const report = createCampaignReport({
      activeHypothesis:
        "If API-server pressure is the bottleneck, create latency and dropped iterations should rise first.",
      confirmStress: true,
      explicitProfileSelection: true,
      preserveOnFailure: {
        enabled: true,
        labels: {
          profile: "stress-medium",
          testid: "stress-20260504-150000",
        },
      },
      profile: "stress-medium",
      runClass: "stress",
      stress: {
        acceptedWork: 10000,
        apiServerPressure: "normal",
        cleanupStatus: "skipped",
        completion: { completedWork: 4000, note: "preserved for inspection" },
        droppedIterations: 0,
        grafanaVisibility: "visible",
        kueueControllerHealth: "healthy",
        rejectionCategories: { rate_limited: 0, server_error: 0, validation: 0 },
        visibleWork: 10000,
        workloadExecution: "running",
      },
      testid: "stress-20260504-150000",
    });

    expect(report.runnable).toBe(false);
    expect(report.blockers).toContain(
      "preserve-on-failure requires testid, profile, and surface labels",
    );
    expect(report.markdown).toContain("| Preserve on failure | enabled |");
  });

  test("describes mixed background and foreground pressure as a later profile model", () => {
    const profile = createMixedPressureProfile({
      activeHypothesis:
        "If foreground users are affected by a deep background queue, foreground visibility latency should rise first.",
      cohorts: [
        { cohort: "background", workloadShape: "one bulk user submits 10000 queued jobs" },
        { cohort: "foreground", workloadShape: "many small users submit one job each" },
      ],
      profile: "mixed-background-foreground",
    });

    expect(profile.status).toBe("later");
    expect(profile.activeHypothesis).toContain("foreground visibility latency");
    expect(profile.cohorts.map((cohort) => cohort.cohort)).toEqual(["background", "foreground"]);
  });

  test("rejects campaign report secrets without echoing them", () => {
    const secret = "Authorization: Bearer skaha-token-abc123";

    expect(() =>
      createCampaignReport({
        activeHypothesis: secret,
        baselines: { exists: true, note: "three prior successful runs" },
        preserveOnFailure: { enabled: false },
        profile: "benchmark-small",
        runClass: "benchmark",
        surfaces: [
          {
            acceptedWork: 1,
            cleanupStatus: "succeeded",
            clusterMetrics: [],
            droppedIterations: 0,
            latency: { p50: "1s", p95: "2s", p99: "3s" },
            surface: "k8s-direct",
            visibleWork: 1,
          },
        ],
        testid: "benchmark-20260504-160000",
      }),
    ).toThrow("campaign report input contains a sensitive value");

    try {
      createCampaignReport({
        activeHypothesis: secret,
        baselines: { exists: true, note: "three prior successful runs" },
        preserveOnFailure: { enabled: false },
        profile: "benchmark-small",
        runClass: "benchmark",
        surfaces: [
          {
            acceptedWork: 1,
            cleanupStatus: "succeeded",
            clusterMetrics: [],
            droppedIterations: 0,
            latency: { p50: "1s", p95: "2s", p99: "3s" },
            surface: "k8s-direct",
            visibleWork: 1,
          },
        ],
        testid: "benchmark-20260504-160000",
      });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
