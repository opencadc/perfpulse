import { describe, expect, test } from "bun:test";

const dashboardPath = "docs/dashboards/perfpulse.json";
const dashboardFilters =
  'testid=~"$testid",run_class=~"$runClass",surface=~"$surface",namespace=~"$namespace"';

describe("Grafana dashboard contract", () => {
  test("ships one import-ready PerfPulse dashboard for cron and benchmarks", async () => {
    const dashboard = await loadDashboard();

    expect(await Bun.file("docs/dashboards/perfpulse-cron.json").exists()).toBe(false);
    expect(await Bun.file("docs/dashboards/perfpulse-campaign.json").exists()).toBe(false);
    expect(dashboard.id).toBeNull();
    expect(dashboard.uid).toBe("perfpulse");
    expect(dashboard.title).toBe("PerfPulse");
    expect(dashboard.schemaVersion).toBe(41);
    expect(dashboard.editable).toBe(false);
    expect(dashboard.tags).toEqual(expect.arrayContaining(["perfpulse", "cron", "benchmark"]));
  });

  test("keeps the UX small and filterable", async () => {
    const dashboard = await loadDashboard();

    expect(variableNames(dashboard)).toEqual(["runClass", "testid", "surface", "namespace"]);
    expect(panelTitles(dashboard)).toEqual([
      "Target State",
      "Expected",
      "Submitted",
      "Running Visible",
      "Cleanup Failed",
      "No Data",
      "Lifecycle By Surface",
      "Latency",
      "Failures By Surface",
      "HTTP And Checks",
      "Runner Load",
      "Kueue Signals",
      "Data IO",
      "API Server p95",
    ]);
    expect(dashboard.panels.length).toBeLessThanOrEqual(14);
  });

  test("uses one canonical run filter across lifecycle panels", async () => {
    const dashboard = await loadDashboard();
    const promQl = allPromQl(dashboard).join("\n");

    expect(promQl).toContain(dashboardFilters);
    expect(promQl).toContain('run_class=~"$runClass"');
    expect(promQl).toContain('testid=~"$testid"');
    expect(promQl).toContain('surface=~"$surface"');
    expect(promQl).not.toContain("campaign_type");
    expect(promQl).not.toContain('profile=~"$profile"');
    expect(promQl).not.toContain('name=~"$request_name"');
    expect(duplicateSelectorMatchers(promQl)).toEqual([]);
  });

  test("makes running visibility the target state and leaves completion diagnostic", async () => {
    const dashboard = await loadDashboard();
    const expressions = expressionsByTitle(dashboard);

    expect(expressions["Target State"]).toContain("k6_perfpulse_jobs_visible_total");
    expect(expressions["Target State"]).not.toContain("k6_perfpulse_jobs_completed_total");
    expect(expressions["Failures By Surface"]).toContain(
      "k6_perfpulse_jobs_completion_failed_total",
    );
    expect(expressions["Failures By Surface"]).toContain("submit deficit");
    expect(expressions["Failures By Surface"]).toContain("visibility deficit");
    expect(descriptionsByTitle(dashboard)["Target State"]).toContain("accepted and observed");
  });

  test("keeps the useful evidence without dashboard sprawl", async () => {
    const dashboard = await loadDashboard();
    const expressions = expressionsByTitle(dashboard);

    expect(expressions["Lifecycle By Surface"]).toContain("k6_perfpulse_jobs_expected");
    expect(expressions["Lifecycle By Surface"]).toContain("k6_perfpulse_jobs_submitted_total");
    expect(expressions["Lifecycle By Surface"]).toContain("k6_perfpulse_jobs_visible_total");
    expect(expressions["Lifecycle By Surface"]).toContain("k6_perfpulse_cleanup_deleted_total");
    expect(expressions["Latency"]).toContain("k6_perfpulse_submission_duration_ms_sum");
    expect(expressions["Latency"]).toContain("k6_perfpulse_visibility_latency_ms_sum");
    expect(expressions["Latency"]).toContain("last_over_time");
    expect(expressions["HTTP And Checks"]).toContain("k6_http_reqs_total");
    expect(expressions["HTTP And Checks"]).toContain("k6_checks_total");
    expect(expressions["Runner Load"]).toContain("k6_iterations_total");
    expect(expressions["Runner Load"]).toContain("k6_dropped_iterations_total");
    expect(expressions["Kueue Signals"]).toContain("k6_perfpulse_kueue_workloads_admitted_total");
    expect(expressions["Data IO"]).toContain("k6_data_sent_bytes_total");
    expect(expressions["API Server p95"]).toContain("apiserver_request_duration_seconds_bucket");
  });

  test("uses readable time-series styling and documented panels", async () => {
    const dashboard = await loadDashboard();
    const timeseriesPanels = dashboard.panels.filter((panel) => panel.type === "timeseries");

    expect(timeseriesPanels.length).toBeGreaterThan(0);
    expect(
      timeseriesPanels.map((panel) => ({
        title: panel.title,
        axisLabel: panel.fieldConfig?.defaults.custom?.axisLabel,
        fillOpacity: panel.fieldConfig?.defaults.custom?.fillOpacity,
        gradientMode: panel.fieldConfig?.defaults.custom?.gradientMode,
        lineInterpolation: panel.fieldConfig?.defaults.custom?.lineInterpolation,
        lineWidth: panel.fieldConfig?.defaults.custom?.lineWidth,
      })),
    ).toEqual(
      timeseriesPanels.map((panel) => ({
        title: panel.title,
        axisLabel: expect.any(String),
        fillOpacity: 5,
        gradientMode: "opacity",
        lineInterpolation: "smooth",
        lineWidth: 2,
      })),
    );
    expect(dashboard.panels.filter((panel) => !panel.description?.trim())).toEqual([]);
    expect(dashboard.templating.list.filter((variable) => !variable.description?.trim())).toEqual(
      [],
    );
  });
});

async function loadDashboard(): Promise<Dashboard> {
  return JSON.parse(await Bun.file(dashboardPath).text()) as Dashboard;
}

function variableNames(dashboard: Dashboard): string[] {
  return dashboard.templating.list.map((variable) => variable.name);
}

function panelTitles(dashboard: Dashboard): string[] {
  return dashboard.panels.map((panel) => panel.title);
}

function expressionsByTitle(dashboard: Dashboard): Record<string, string> {
  return Object.fromEntries(
    dashboard.panels.map((panel) => [panel.title, targetExpressions(panel).join("\n")]),
  );
}

function descriptionsByTitle(dashboard: Dashboard): Record<string, string> {
  return Object.fromEntries(
    dashboard.panels.map((panel) => [panel.title, panel.description ?? ""]),
  );
}

function allPromQl(dashboard: Dashboard): string[] {
  return [
    ...dashboard.panels.flatMap((panel) => targetExpressions(panel)),
    ...dashboard.templating.list.flatMap((variable) => [
      variable.definition ?? "",
      typeof variable.query === "object" ? (variable.query.query ?? "") : "",
    ]),
  ].filter((expr) => expr !== "");
}

function targetExpressions(panel: Panel): string[] {
  return (panel.targets ?? []).map(
    (target) => `${target.expr ?? ""}\n${target.legendFormat ?? ""}`,
  );
}

function duplicateSelectorMatchers(expr: string): string[] {
  return [...expr.matchAll(/\{([^{}]*)\}/g)].flatMap((selectorMatch) => {
    const selector = selectorMatch[1];
    if (selector === undefined) {
      return [];
    }
    const labels = new Set<string>();
    const duplicates = new Set<string>();
    for (const matcher of selector.split(",")) {
      const labelMatch = matcher.match(/^\s*([a-zA-Z_:][a-zA-Z0-9_:]*)\s*(?:=~|!~|!=|=)/);
      if (!labelMatch) {
        continue;
      }
      const label = labelMatch[1];
      if (label === undefined) {
        continue;
      }
      if (labels.has(label)) {
        duplicates.add(label);
      }
      labels.add(label);
    }

    return [...duplicates].map((label) => `${label} in {${selector}}`);
  });
}

type Dashboard = {
  editable: boolean;
  id: null;
  panels: Panel[];
  schemaVersion: number;
  tags: string[];
  templating: {
    list: Array<{
      description?: string;
      definition?: string;
      name: string;
      query?: {
        query?: string;
      };
    }>;
  };
  title: string;
  uid: string;
};

type Panel = {
  description?: string;
  fieldConfig?: {
    defaults: {
      custom?: {
        axisLabel?: string;
        fillOpacity?: number;
        gradientMode?: string;
        lineInterpolation?: string;
        lineWidth?: number;
      };
    };
  };
  targets?: Array<{
    expr?: string;
    legendFormat?: string;
  }>;
  title: string;
  type: string;
};
