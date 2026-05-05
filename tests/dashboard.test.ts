import { describe, expect, test } from "bun:test";

describe("Grafana dashboard contracts", () => {
  test("uses the production dashboard and Prometheus datasource uids", async () => {
    const dashboardJson = await Bun.file(
      "docs/dashboards/perfpulse-m1-spot-direct-tiny.json",
    ).text();
    const dashboard = JSON.parse(dashboardJson) as Dashboard;
    const templatedPrometheusUid = "$" + "{DS_PROMETHEUS}";

    expect(dashboard.uid).toBe("perfpulse");
    expect(dashboardJson).not.toContain(templatedPrometheusUid);

    const datasourceRefs = [
      ...dashboard.panels.map((panel) => panel.datasource),
      ...dashboard.templating.list.map((variable) => variable.datasource),
    ].filter((datasource): datasource is Datasource => datasource?.type === "prometheus");

    expect(datasourceRefs.length).toBeGreaterThan(0);
    expect(datasourceRefs).toEqual(
      datasourceRefs.map(() => ({
        type: "prometheus",
        uid: "prometheus",
      })),
    );
  });

  test("uses durable range selectors for completed-run stat panels", async () => {
    const dashboard = await loadDashboard();

    const statExpressions = Object.fromEntries(
      dashboard.panels
        .filter((panel) => panel.type === "stat")
        .map((panel) => [panel.title, panel.targets[0]?.expr]),
    );

    expect(statExpressions).toMatchObject({
      "Cleanup Failures":
        'sum(last_over_time(k6_perfpulse_cleanup_failed_total{testid="$testid",surface=~"$surface"}[$__range]))',
      "Jobs Completed":
        'sum(last_over_time(k6_perfpulse_jobs_completed_total{testid="$testid",surface=~"$surface"}[$__range]))',
      "Jobs Submitted":
        'sum(last_over_time(k6_perfpulse_jobs_submitted_total{testid="$testid",surface=~"$surface"}[$__range]))',
      "Jobs Visible":
        'sum(last_over_time(k6_perfpulse_jobs_visible_total{testid="$testid",surface=~"$surface"}[$__range]))',
    });
    expect(Object.values(statExpressions).join("\n")).not.toContain("increase(");
  });

  test("uses sparse completed-run histogram buckets for latency panels", async () => {
    const dashboard = await loadDashboard();

    const latencyExpressions = Object.fromEntries(
      dashboard.panels
        .filter((panel) => panel.title.endsWith("Latency"))
        .map((panel) => [panel.title, panel.targets.map((target) => target.expr ?? "")]),
    );

    expect(latencyExpressions).toMatchObject({
      "Completion Latency": [
        'histogram_quantile(0.50, sum by (le, surface) (last_over_time(k6_perfpulse_completion_latency_ms_bucket{testid="$testid",surface=~"$surface"}[$__range])))',
        'histogram_quantile(0.95, sum by (le, surface) (last_over_time(k6_perfpulse_completion_latency_ms_bucket{testid="$testid",surface=~"$surface"}[$__range])))',
        'histogram_quantile(0.99, sum by (le, surface) (last_over_time(k6_perfpulse_completion_latency_ms_bucket{testid="$testid",surface=~"$surface"}[$__range])))',
      ],
      "Submission Latency": [
        'histogram_quantile(0.50, sum by (le, surface) (last_over_time(k6_perfpulse_submission_duration_ms_bucket{testid="$testid",surface=~"$surface"}[$__range])))',
        'histogram_quantile(0.95, sum by (le, surface) (last_over_time(k6_perfpulse_submission_duration_ms_bucket{testid="$testid",surface=~"$surface"}[$__range])))',
        'histogram_quantile(0.99, sum by (le, surface) (last_over_time(k6_perfpulse_submission_duration_ms_bucket{testid="$testid",surface=~"$surface"}[$__range])))',
      ],
    });

    const allLatencyExpressions = Object.values(latencyExpressions).flat().join("\n");

    expect(allLatencyExpressions).toContain("histogram_quantile(");
    expect(allLatencyExpressions).toContain("last_over_time(");
    expect(allLatencyExpressions).toContain("_bucket");
    expect(allLatencyExpressions).not.toMatch(/_p(?:50|95|99)\b/);
  });
});

async function loadDashboard(): Promise<Dashboard> {
  return JSON.parse(
    await Bun.file("docs/dashboards/perfpulse-m1-spot-direct-tiny.json").text(),
  ) as Dashboard;
}

type Dashboard = {
  panels: Array<{
    datasource?: Datasource;
    targets: Array<{
      expr?: string;
    }>;
    title: string;
    type: string;
  }>;
  templating: {
    list: Array<{
      datasource?: Datasource;
    }>;
  };
  uid: string;
};

type Datasource = {
  type: string;
  uid: string;
};
