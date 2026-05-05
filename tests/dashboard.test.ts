import { describe, expect, test } from "bun:test";

describe("Grafana dashboard contracts", () => {
  test("uses durable range selectors for completed-run stat panels", async () => {
    const dashboard = JSON.parse(
      await Bun.file("docs/dashboards/perfpulse-m1-spot-direct-tiny.json").text(),
    ) as Dashboard;

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
});

type Dashboard = {
  panels: Array<{
    targets: Array<{
      expr?: string;
    }>;
    title: string;
    type: string;
  }>;
};
