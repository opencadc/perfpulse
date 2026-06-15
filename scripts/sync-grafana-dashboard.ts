/**
 * Apply operator-focused dashboard refinements and optionally publish to Grafana.
 * Run: bun scripts/sync-grafana-dashboard.ts [--publish]
 */
const dashboardPath = "docs/dashboards/perfpulse.json";
const publish = process.argv.includes("--publish");

const dashboard = JSON.parse(await Bun.file(dashboardPath).text()) as {
  uid: string;
  version?: number;
  id?: number | null;
  panels: Array<Record<string, unknown>>;
  description?: string;
  refresh?: string;
  templating: { list: Array<Record<string, unknown>> };
};

dashboard.uid = "perfpulse-dashboard";
dashboard.refresh = "1m";

const filters =
  'testid=~"$testid",run_class=~"$runClass",profile=~"$profile",surface=~"$surface",scenario=~"$scenario",cohort=~"$cohort",job_profile=~"$job_profile",namespace=~"$namespace",campaign_type=~"$campaignType"';

// Cron runs emit one OTLP sample per unique testid; increase() is empty on those sparse counters.
const cronHealthExpr = (surface: string, window = "15m") =>
  `100 * count(sum by (testid) (last_over_time(k6_perfpulse_jobs_completed_total{profile="cron",surface="${surface}"}[${window}])) >= 1) / clamp_min(count(sum by (testid) (last_over_time(k6_perfpulse_jobs_expected{profile="cron",surface="${surface}"}[${window}])) >= 1), 1)`;

const cronHealthTrendExpr = (surface: string) =>
  `count(sum by (testid) (last_over_time(k6_perfpulse_jobs_completed_total{profile="cron",surface="${surface}"}[5m])) >= 1) / clamp_min(count(sum by (testid) (last_over_time(k6_perfpulse_jobs_expected{profile="cron",surface="${surface}"}[5m])) >= 1), 1)`;

for (const panel of dashboard.panels) {
  const title = panel.title as string;
  const targets = panel.targets as Array<{ expr?: string; legendFormat?: string }> | undefined;

  if (title === "Cron Direct OK" && targets?.[0]) {
    targets[0].expr = cronHealthExpr("k8s-direct");
    panel.description =
      "Target-state percentage for k8s-direct cron checks observed in the last 15 minutes.";
  }
  if (title === "Cron Kueue OK" && targets?.[0]) {
    targets[0].expr = cronHealthExpr("k8s-kueue");
    panel.description =
      "Target-state percentage for k8s-kueue cron checks observed in the last 15 minutes.";
  }
  if (title === "Cron Skaha OK" && targets?.[0]) {
    targets[0].expr = cronHealthExpr("skaha");
    panel.description =
      "Target-state percentage for skaha cron checks observed in the last 15 minutes.";
  }

  if (title === "Run Outcome Trend" && targets) {
    panel.title = "Surface Lifecycle Trend";
    panel.description =
      "Lifecycle counts aggregated by surface for the selected filters. Prefer this over per-testid trends when testid is All.";
    targets[0] = {
      expr: `sum by (surface) (k6_perfpulse_jobs_submitted_total{${filters}})`,
      legendFormat: "{{surface}} submitted",
      refId: "A",
    };
    targets[1] = {
      expr: `sum by (surface) (k6_perfpulse_jobs_visible_total{${filters}})`,
      legendFormat: "{{surface}} visible",
      refId: "B",
    };
    targets[2] = {
      expr: `sum by (surface) (k6_perfpulse_jobs_completed_total{${filters}})`,
      legendFormat: "{{surface}} completed",
      refId: "C",
    };
    targets.length = 3;
  }

  if (title === "Target State Reached" && targets?.[0]) {
    panel.description =
      "Terminal completion percentage by surface. Empty when no jobs reached a successful terminal state for the selected filters.";
    targets[0].legendFormat = "{{surface}} completed / expected";
    targets[1] = {
      expr: `sum by (surface) (last_over_time(k6_perfpulse_jobs_completion_failed_total{${filters}}[$__range])) / clamp_min(sum by (surface) (last_over_time(k6_perfpulse_jobs_expected{${filters}}[$__range])), 1)`,
      legendFormat: "{{surface}} completion failed / expected",
      refId: "B",
    };
  }
}

const hasCronTrend = dashboard.panels.some((panel) => panel.title === "Cron Health Trend");
if (!hasCronTrend) {
  const cronTrendY = 12;
  for (const panel of dashboard.panels) {
    const gridPos = panel.gridPos as { y: number } | undefined;
    if (gridPos !== undefined && gridPos.y >= cronTrendY) {
      gridPos.y += 8;
    }
  }

  dashboard.panels.splice(5, 0, {
    datasource: { type: "prometheus", uid: "prometheus" },
    description:
      "Rolling cron target-state percentage by surface using 15-minute windows. Values below 100% mean recent cron checks did not fully complete.",
    fieldConfig: {
      defaults: {
        color: { mode: "palette-classic" },
        mappings: [],
        thresholds: {
          mode: "absolute",
          steps: [
            { color: "red", value: null },
            { color: "red", value: 0 },
            { color: "yellow", value: 0.5 },
            { color: "green", value: 1 },
          ],
        },
        unit: "percentunit",
        custom: {
          axisLabel: "Cron target state %",
          drawStyle: "line",
          lineInterpolation: "smooth",
          lineWidth: 2,
          fillOpacity: 5,
          gradientMode: "opacity",
        },
      },
      overrides: [],
    },
    gridPos: { h: 8, w: 24, x: 0, y: cronTrendY },
    id: 44,
    options: {
      legend: { calcs: ["lastNotNull"], displayMode: "list", placement: "bottom", showLegend: true },
      tooltip: { mode: "multi", sort: "none" },
    },
    pluginVersion: "11.0.0",
    targets: [
      {
        expr: cronHealthTrendExpr("k8s-direct"),
        legendFormat: "k8s-direct",
        refId: "A",
      },
      {
        expr: cronHealthTrendExpr("k8s-kueue"),
        legendFormat: "k8s-kueue",
        refId: "B",
      },
      {
        expr: cronHealthTrendExpr("skaha"),
        legendFormat: "skaha",
        refId: "C",
      },
    ],
    title: "Cron Health Trend",
    type: "timeseries",
  });
}

dashboard.description =
  "Operator overview for PerfPulse run health. Start with Operator Health for cron acceptance without picking a testid; use Recent Cron Runs to choose a failing testid. When testid is All, top stat totals aggregate every run in the time range. Filtered panels below follow the selected variables.";

const profileVar = dashboard.templating.list.find((variable) => variable.name === "profile");
if (profileVar !== undefined) {
  profileVar.current = { selected: true, text: "cron", value: "cron" };
}

await Bun.write(dashboardPath, `${JSON.stringify(dashboard, null, 2)}\n`);
console.log(`Updated ${dashboardPath}`);

if (publish) {
  console.log("Use browser session to publish (see sync output).");
}
