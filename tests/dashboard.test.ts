import { describe, expect, test } from "bun:test";

const campaignDashboardPath = "docs/dashboards/perfpulse-campaign.json";
const cronDashboardPath = "docs/dashboards/perfpulse-cron.json";
const dashboardFilters =
  'testid=~"$testid",run_class=~"$runClass",profile=~"$profile",surface=~"$surface",scenario=~"$scenario",namespace=~"$namespace",campaign_type=~"$campaignType"';

describe("Grafana dashboard contracts", () => {
  test("ships import-ready cron and campaign dashboard shapes", async () => {
    const [cronDashboard, campaignDashboard] = await Promise.all([
      loadDashboard(cronDashboardPath),
      loadDashboard(campaignDashboardPath),
    ]);

    expect(cronDashboard.id).toBeNull();
    expect(campaignDashboard.id).toBeNull();
    expect(cronDashboard.schemaVersion).toBe(39);
    expect(campaignDashboard.schemaVersion).toBe(39);
    expect(cronDashboard.title).toContain("Cron");
    expect(campaignDashboard.title).toContain("Campaign");
    expect(cronDashboard.uid).toBe("perfpulse-cron");
    expect(campaignDashboard.uid).toBe("perfpulse-campaign");
    expect(cronDashboard.editable).toBe(false);
    expect(campaignDashboard.editable).toBe(false);
    expect(cronDashboard.tags).toContain("perfpulse");
    expect(campaignDashboard.tags).toContain("perfpulse");
  });

  test("keeps the cron dashboard focused on operator health and cluster context", async () => {
    const dashboard = await loadDashboard(cronDashboardPath);
    const panelTitles = dashboard.panels.map((panel) => panel.title);
    const promQl = allPromQlExpressions(dashboard).join("\n");

    expect(dashboard.templating.list).toEqual([]);
    expect(panelTitles).toEqual(
      expect.arrayContaining([
        "Operator Health",
        "Cron Direct OK",
        "Cron Kueue OK",
        "Cron Skaha OK",
        "Recent Cron Runs",
        "Cron Health Trend",
        "Kueue Cluster State",
        "Kubernetes API State",
      ]),
    );
    expect(panelTitles).not.toContain("Diagnosis Matrix");
    expect(panelTitles).not.toContain("HTTP Analytics");
    expect(dashboard.panels[0]?.title).toBe("Operator Health");
    expect(promQl).toContain('profile="cron"');
    expect(promQl).toContain("last_over_time(");
    expect(promQl).not.toContain('testid=~"$testid"');
  });

  test("uses canonical campaign variables and Prometheus datasource uids", async () => {
    const dashboardJson = await Bun.file(campaignDashboardPath).text();
    const dashboard = JSON.parse(dashboardJson) as Dashboard;
    const templatedPrometheusUid = "$" + "{DS_PROMETHEUS}";

    expect(dashboardJson).not.toContain(templatedPrometheusUid);
    expect(dashboardJson).not.toContain("perfpulse_surface_expected");
    expect(dashboard.templating.list.map((variable) => variable.name)).toEqual([
      "testid",
      "runClass",
      "profile",
      "campaignType",
      "surface",
      "scenario",
      "namespace",
      "request_name",
    ]);
    expect(dashboard.templating.list.map((variable) => variable.refresh)).toEqual(
      dashboard.templating.list.map(() => 2),
    );

    const expectedWorkVariableQueries = dashboard.templating.list
      .filter((variable) => variable.name !== "request_name")
      .flatMap((variable) => [variable.definition ?? "", variable.query?.query ?? ""])
      .join("\n");
    expect(expectedWorkVariableQueries).toContain("k6_perfpulse_jobs_expected");
    expect(expectedWorkVariableQueries).not.toContain("k6_perfpulse_jobs_submitted_total");

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

  test("uses durable range selectors for campaign stat panels and stress-aware target state", async () => {
    const dashboard = await loadDashboard(campaignDashboardPath);
    const statExpressions = Object.fromEntries(
      dashboard.panels
        .filter((panel) => panel.type === "stat")
        .map((panel) => [panel.title, targetExpressions(panel)[0]]),
    );

    expect(statExpressions).toMatchObject({
      "Cleanup Failures": `sum(last_over_time(k6_perfpulse_cleanup_failed_total{${dashboardFilters}}[$__range]))`,
      "Completion Failures": `sum(last_over_time(k6_perfpulse_jobs_completion_failed_total{${dashboardFilters}}[$__range]))`,
      "Expected Jobs": `sum(last_over_time(k6_perfpulse_jobs_expected{${dashboardFilters}}[$__range]))`,
      "Jobs Completed": `sum(last_over_time(k6_perfpulse_jobs_completed_total{${dashboardFilters}}[$__range]))`,
      "Jobs Submitted": `sum(last_over_time(k6_perfpulse_jobs_submitted_total{${dashboardFilters}}[$__range]))`,
      "Jobs Visible": `sum(last_over_time(k6_perfpulse_jobs_visible_total{${dashboardFilters}}[$__range]))`,
    });
    expect(statExpressions["Expected Jobs"]).not.toContain("or vector(0)");
    expect(Object.values(statExpressions).join("\n")).toContain("last_over_time(");
    expect(Object.values(statExpressions).join("\n")).not.toContain("increase(");

    const targetStateOkExpression = statExpressions["Target State OK"] ?? "";
    expect(targetStateOkExpression).toContain("100 *");
    expect(targetStateOkExpression).toContain("k6_perfpulse_jobs_completed_total");
    expect(targetStateOkExpression).toContain("k6_perfpulse_jobs_visible_total");
    expect(targetStateOkExpression).toContain('campaign_type="stress"');
    expect(targetStateOkExpression).toContain("/ clamp_min(");
  });

  test("uses sparse completed-run histogram buckets for campaign latency panels", async () => {
    const dashboard = await loadDashboard(campaignDashboardPath);
    const latencyExpressions = Object.fromEntries(
      dashboard.panels
        .filter((panel) =>
          [
            "Completion Latency When Observed",
            "Kueue Admission Latency",
            "Submission Latency",
            "Visibility Latency",
          ].includes(panel.title),
        )
        .map((panel) => [panel.title, targetExpressions(panel)]),
    );

    expect(Object.keys(latencyExpressions).sort()).toEqual([
      "Completion Latency When Observed",
      "Kueue Admission Latency",
      "Submission Latency",
      "Visibility Latency",
    ]);

    const allLatencyExpressions = Object.values(latencyExpressions).flat().join("\n");
    expect(allLatencyExpressions).toContain("histogram_quantile(");
    expect(allLatencyExpressions).toContain("last_over_time(");
    expect(allLatencyExpressions).toContain("_bucket");
    expect(allLatencyExpressions).toContain('testid=~"$testid"');
    expect(allLatencyExpressions).toContain('surface=~"$surface"');
    expect(allLatencyExpressions).not.toMatch(/_p(?:50|95|99)\b/u);

    const completionLatencyExpressions =
      latencyExpressions["Completion Latency When Observed"] ?? [];
    expect(completionLatencyExpressions.join("\n")).toContain("rate(");
    expect(completionLatencyExpressions.join("\n")).toContain(
      "k6_perfpulse_completion_latency_ms_sum",
    );
    expect(completionLatencyExpressions.join("\n")).not.toContain("last_over_time(");
  });

  test("uses regex matchers for multi-value campaign variables", async () => {
    const dashboard = await loadDashboard(campaignDashboardPath);
    const multiIncludeAllVariables = dashboard.templating.list.filter(
      (variable) => variable.multi && variable.includeAll && variable.allValue === ".*",
    );
    const promQl = allPromQlExpressions(dashboard).join("\n");

    expect(multiIncludeAllVariables.map((variable) => variable.name)).toEqual([
      "testid",
      "runClass",
      "profile",
      "campaignType",
      "surface",
      "scenario",
      "namespace",
      "request_name",
    ]);
    expect(promQl).toContain('testid=~"$testid"');
    expect(promQl).toContain('name=~"$request_name"');
    expect(promQl).not.toContain('testid="$testid"');
  });

  test("uses current cron and campaign taxonomy without old cohort assumptions", async () => {
    const cronDashboard = await loadDashboard(cronDashboardPath);
    const campaignDashboard = await loadDashboard(campaignDashboardPath);
    const campaignJson = JSON.stringify(campaignDashboard);
    const campaignPromQl = allPromQlExpressions(campaignDashboard).join("\n");

    expect(campaignDashboard.templating.list.map((variable) => variable.name)).toContain(
      "runClass",
    );
    expect(campaignDashboard.templating.list.map((variable) => variable.name)).toContain(
      "campaignType",
    );
    expect(campaignPromQl).toContain('run_class=~"$runClass"');
    expect(campaignPromQl).toContain('campaign_type=~"$campaignType"');
    expect(campaignPromQl).toContain('profile=~"$profile"');
    expect(campaignJson).not.toMatch(/cohort|job_profile/u);
    expect(campaignJson).not.toContain('run_class=~"$run_class"');
    expect(JSON.stringify(cronDashboard)).not.toContain("cohort");
  });

  test("documents dashboard panels and template variables for operators", async () => {
    const [cronDashboard, campaignDashboard] = await Promise.all([
      loadDashboard(cronDashboardPath),
      loadDashboard(campaignDashboardPath),
    ]);
    const campaignPanelDescriptions = Object.fromEntries(
      campaignDashboard.panels.map((panel) => [panel.title, panel.description ?? ""]),
    );

    expect(cronDashboard.description?.trim()).not.toBe("");
    expect(cronDashboard.description).toContain("Operator Health");
    expect(cronDashboard.description).toContain("Recent Cron Runs");
    expect(campaignDashboard.description?.trim()).not.toBe("");
    expect(campaignDashboard.description).toContain("benchmark and stress");
    expect(campaignPanelDescriptions["Diagnosis Matrix"]).toContain("shown as one table");
    expect(campaignPanelDescriptions["Diagnosis Matrix"]).toContain("accepted create response");
    expect(campaignPanelDescriptions["Target State Reached"]).toContain(
      "stress runs treat visibility",
    );
    expect(campaignPanelDescriptions["Target State Failures"]).toContain(
      "completion failures only count",
    );
    expect(campaignPanelDescriptions["Submission Latency"]).toContain(
      "measured from request start until the create response returns",
    );
    expect(campaignPanelDescriptions["Visibility Latency"]).toContain(
      "measured from accepted create response",
    );
    expect(campaignPanelDescriptions["Completion Latency When Observed"]).toContain(
      "Post-submit completion latency",
    );
    expect(
      [...cronDashboard.panels, ...campaignDashboard.panels]
        .filter((panel) => !panel.description?.trim())
        .map((panel) => panel.title),
    ).toEqual([]);
    expect(
      campaignDashboard.templating.list
        .filter((variable) => !variable.description?.trim())
        .map((variable) => variable.name),
    ).toEqual([]);
  });

  test("uses consistent readable timeseries styling and axis labels", async () => {
    const [cronDashboard, campaignDashboard] = await Promise.all([
      loadDashboard(cronDashboardPath),
      loadDashboard(campaignDashboardPath),
    ]);
    const timeseriesPanels = [...cronDashboard.panels, ...campaignDashboard.panels].filter(
      (panel) => panel.type === "timeseries",
    );

    expect(timeseriesPanels.length).toBeGreaterThan(0);
    expect(
      timeseriesPanels.map((panel) => ({
        title: panel.title,
        fillOpacity: panel.fieldConfig?.defaults.custom?.fillOpacity,
        gradientMode: panel.fieldConfig?.defaults.custom?.gradientMode,
        lineInterpolation: panel.fieldConfig?.defaults.custom?.lineInterpolation,
        lineWidth: panel.fieldConfig?.defaults.custom?.lineWidth,
      })),
    ).toEqual(
      timeseriesPanels.map((panel) => ({
        title: panel.title,
        fillOpacity: 5,
        gradientMode: "opacity",
        lineInterpolation: "smooth",
        lineWidth: 2,
      })),
    );
    expect(
      timeseriesPanels
        .filter((panel) => !panel.fieldConfig?.defaults.custom?.axisLabel?.trim())
        .map((panel) => panel.title),
    ).toEqual([]);
  });

  test("does not emit duplicate label matchers inside one PromQL selector", async () => {
    const [cronDashboard, campaignDashboard] = await Promise.all([
      loadDashboard(cronDashboardPath),
      loadDashboard(campaignDashboardPath),
    ]);
    const duplicateMatchers = [
      ...allPromQlExpressions(cronDashboard),
      ...allPromQlExpressions(campaignDashboard),
    ].flatMap((expr) => duplicateSelectorMatchers(expr));

    expect(duplicateMatchers).toEqual([]);
  });

  test("uses truthful k6 check pass and failure rate signals on campaign dashboard", async () => {
    const dashboard = await loadDashboard(campaignDashboardPath);
    const checksPanel = dashboard.panels.find((panel) => panel.title === "Checks Pass Rate");
    const checksExpressions = checksPanel ? targetExpressions(checksPanel) : [];
    const joinedExpressions = checksExpressions.join("\n");

    expect(checksPanel?.type).toBe("timeseries");
    expect(checksExpressions.length).toBe(2);
    expect(checksExpressions[0]).toContain("k6_checks_total{");
    expect(checksExpressions[0]).toContain('condition="nonzero"');
    expect(checksExpressions[0]).toContain('condition=~"zero|nonzero"');
    expect(checksExpressions[1]).toContain("k6_checks_total{");
    expect(checksExpressions[1]).toContain('condition="zero"');
    expect(checksExpressions[1]).toContain('condition=~"zero|nonzero"');
    expect(joinedExpressions).not.toContain("k6_checks_rate");
    expect(joinedExpressions).not.toContain("clamp_min(");
    expect(joinedExpressions).toContain("+ 1e-12");
    expect(checksExpressions.every((expr) => expr.includes("sum(rate("))).toBe(true);
    expect(checksExpressions.every((expr) => expr.includes("[$__rate_interval]"))).toBe(true);
    expect(checksPanel?.targets?.map((target) => target.legendFormat)).toEqual([
      "checks passed",
      "checks failed",
    ]);
  });

  test("keeps diagnosis, no-data, and cleanup panels tied to expected-job denominators", async () => {
    const dashboard = await loadDashboard(campaignDashboardPath);
    const diagnosisPanel = dashboard.panels.find((panel) => panel.title === "Diagnosis Matrix");
    const noDataPanel = dashboard.panels.find((panel) => panel.title === "No Data Warning");
    const cleanupPanel = dashboard.panels.find((panel) => panel.title === "Cleanup");
    const targetStateFailuresPanel = dashboard.panels.find(
      (panel) => panel.title === "Target State Failures",
    );

    if (
      diagnosisPanel === undefined ||
      noDataPanel === undefined ||
      cleanupPanel === undefined ||
      targetStateFailuresPanel === undefined
    ) {
      throw new Error("Campaign dashboard missing key lifecycle panels");
    }

    const diagnosisExpressions = targetExpressions(diagnosisPanel).join("\n");
    const noDataExpression = targetExpressions(noDataPanel).join("\n");
    const cleanupExpressions = targetExpressions(cleanupPanel).join("\n");
    const targetStateFailureExpressions = targetExpressions(targetStateFailuresPanel).join("\n");

    expect(diagnosisPanel.type).toBe("table");
    expect(diagnosisPanel.transformations).toEqual([{ id: "merge", options: {} }]);
    expect(displayNameOverrides(diagnosisPanel)).toEqual([
      "Expected",
      "Submitted",
      "Visible",
      "Target state",
      "Submit failed",
      "Visible failed",
      "Target failed",
      "Cleanup failed",
    ]);
    expect(diagnosisExpressions).toContain("sum by (surface)");
    expect(diagnosisExpressions).toContain("clamp_min(");
    expect(diagnosisExpressions).toContain("k6_perfpulse_jobs_submitted_total");
    expect(diagnosisExpressions).toContain("k6_perfpulse_jobs_visibility_failed_total");
    expect(diagnosisExpressions).toContain("k6_perfpulse_jobs_completion_failed_total");

    expect(noDataPanel.type).toBe("stat");
    expect(noDataExpression).toContain("absent(");
    expect(noDataExpression).toContain("last_over_time(");
    expect(noDataExpression).toContain(`k6_perfpulse_jobs_expected{${dashboardFilters}}`);
    expect(noDataPanel.fieldConfig?.defaults.thresholds?.steps).toContainEqual({
      color: "red",
      value: 1,
    });

    expect(cleanupExpressions).toContain("k6_perfpulse_cleanup_deleted_total");
    expect(cleanupExpressions).toContain("k6_perfpulse_cleanup_failed_total");
    expect(cleanupExpressions).toContain("k6_perfpulse_jobs_expected");
    expect(cleanupExpressions).toContain("/ clamp_min(");
    expect(cleanupPanel.fieldConfig?.defaults.custom?.axisLabel).toBe("% of expected jobs");

    expect(targetStateFailureExpressions).toContain("k6_perfpulse_jobs_visibility_failed_total");
    expect(targetStateFailureExpressions).toContain("k6_perfpulse_jobs_completion_failed_total");
    expect(targetStateFailureExpressions).toContain('campaign_type="stress"');
    expect(targetStateFailureExpressions).toContain("/ clamp_min(");
  });

  test("includes runtime, HTTP analytics, and best-effort cluster state on campaign dashboard", async () => {
    const dashboard = await loadDashboard(campaignDashboardPath);
    const expressionsByTitle = Object.fromEntries(
      dashboard.panels.map((panel) => [panel.title, targetExpressions(panel).join("\n")]),
    );

    expect(expressionsByTitle["Surface Lifecycle Trend"]).toContain("sum by (surface)");
    expect(expressionsByTitle["Surface Lifecycle Trend"]).toContain(
      "k6_perfpulse_jobs_submitted_total",
    );
    expect(expressionsByTitle["Surface Lifecycle Trend"]).toContain(
      "k6_perfpulse_jobs_completed_total",
    );
    expect(expressionsByTitle["Dropped Iterations"]).toContain("k6_dropped_iterations_total");
    expect(expressionsByTitle.Iterations).toContain("k6_iterations_total");
    expect(expressionsByTitle["Virtual Users"]).toContain("k6_vus");
    expect(expressionsByTitle["Data IO"]).toContain("k6_data_sent_bytes_total");
    expect(expressionsByTitle["Data IO"]).toContain("k6_data_received_bytes_total");
    expect(expressionsByTitle["Data IO"]).not.toContain("k6_data_sent_total");
    expect(expressionsByTitle["Data IO"]).not.toContain("k6_data_received_total");
    expect(expressionsByTitle["HTTP Requests"]).toContain("k6_http_reqs_total");
    expect(expressionsByTitle["HTTP Failure Rate"]).toContain("k6_http_req_failed_total");
    expect(expressionsByTitle["HTTP Duration p95"]).toContain(
      "k6_http_req_duration_milliseconds_bucket",
    );
    expect(expressionsByTitle["HTTP Duration Heatmap"]).toContain(
      "k6_http_req_duration_milliseconds_bucket",
    );
    expect(dashboard.panels.find((panel) => panel.title === "HTTP Duration Heatmap")?.type).toBe(
      "heatmap",
    );
    expect(expressionsByTitle["HTTP Requests"]).toContain('name=~"$request_name"');
    expect(expressionsByTitle["Kueue Workloads Admitted"]).toContain(
      "sum by (cluster_queue) (kueue_admitted_workloads_total",
    );
    expect(expressionsByTitle["Kueue Workloads Pending"]).toContain(
      "sum by (cluster_queue, status) (kueue_pending_workloads",
    );
    expect(expressionsByTitle["Kueue Controller Restarts"]).toContain(
      "sum (increase(kube_pod_container_status_restarts_total",
    );
    expect(expressionsByTitle["API Server p95 Latency"]).toContain(
      "apiserver_request_duration_seconds_bucket",
    );
  });
});

async function loadDashboard(path: string): Promise<Dashboard> {
  return JSON.parse(await Bun.file(path).text()) as Dashboard;
}

function targetExpressions(panel: Panel): string[] {
  return (panel.targets ?? []).map((target) => target.expr ?? "");
}

function allPromQlExpressions(dashboard: Dashboard): string[] {
  return [
    ...dashboard.panels.flatMap((panel) => targetExpressions(panel)),
    ...dashboard.templating.list.flatMap((variable) => [
      variable.definition ?? "",
      variable.query?.query ?? "",
    ]),
  ].filter((expr) => expr !== "");
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

function displayNameOverrides(panel: Panel): string[] {
  return (
    panel.fieldConfig?.overrides
      ?.flatMap((override) => override.properties)
      .filter((property) => property.id === "displayName")
      .map((property) => property.value) ?? []
  );
}

type Panel = {
  description?: string;
  datasource?: Datasource;
  fieldConfig?: {
    defaults: {
      custom?: {
        axisLabel?: string;
        fillOpacity?: number;
        gradientMode?: string;
        lineInterpolation?: string;
        lineWidth?: number;
      };
      thresholds?: {
        steps: Array<{
          color: string;
          value: number | null;
        }>;
      };
    };
    overrides?: Array<{
      matcher: {
        id: string;
        options: string;
      };
      properties: Array<{
        id: string;
        value: string;
      }>;
    }>;
  };
  options?: Record<string, unknown>;
  targets?: Array<{
    expr?: string;
    legendFormat?: string;
  }>;
  title: string;
  transformations?: Array<{
    id: string;
    options?: Record<string, unknown>;
  }>;
  type: string;
};

type Dashboard = {
  description?: string;
  editable: boolean;
  id: null;
  panels: Panel[];
  schemaVersion: number;
  tags: string[];
  templating: {
    list: Array<{
      allValue?: string;
      datasource?: Datasource;
      definition?: string;
      description?: string;
      includeAll?: boolean;
      multi?: boolean;
      name: string;
      query?: {
        query?: string;
      };
      refresh?: number;
    }>;
  };
  title: string;
  uid: string;
};

type Datasource = {
  type: string;
  uid: string;
};
