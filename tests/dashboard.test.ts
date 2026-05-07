import { describe, expect, test } from "bun:test";

describe("Grafana dashboard contracts", () => {
  test("uses an import-ready top-level dashboard shape", async () => {
    const dashboard = await loadDashboard();

    expect(dashboard.id).toBeNull();
    expect(dashboard.tags).toEqual(["perfpulse", "overview"]);
    expect(dashboard.schemaVersion).toBe(39);
    expect(dashboard.title).toBe("PerfPulse Overview");
    expect(dashboard.uid).toBe("perfpulse");
    expect(dashboard.editable).toBe(false);
  });

  test("uses the canonical overview dashboard variables and Prometheus datasource uids", async () => {
    const dashboardJson = await Bun.file("docs/dashboards/perfpulse.json").text();
    const dashboard = JSON.parse(dashboardJson) as Dashboard;
    const templatedPrometheusUid = "$" + "{DS_PROMETHEUS}";

    expect(dashboard.uid).toBe("perfpulse");
    expect(dashboard.title).toBe("PerfPulse Overview");
    expect(dashboardJson).not.toContain(templatedPrometheusUid);
    expect(dashboardJson).not.toContain("perfpulse_surface_expected");

    expect(dashboard.templating.list.map((variable) => variable.name)).toEqual([
      "testid",
      "runClass",
      "profile",
      "campaignType",
      "surface",
      "scenario",
      "cohort",
      "job_profile",
      "namespace",
      "request_name",
    ]);
    expect(dashboard.templating.list.map((variable) => variable.refresh)).toEqual(
      dashboard.templating.list.map(() => 2),
    );

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

    expect(dashboard.panels.map((panel) => [panel.title, panel.type])).toEqual(
      expect.arrayContaining([
        ["Diagnosis Matrix", "table"],
        ["Run Outcome", "stat"],
        ["Run Outcome Trend", "timeseries"],
        ["No Data Warning", "stat"],
        ["k6 Runtime", "row"],
        ["HTTP Analytics", "row"],
        ["Kueue Cluster State", "row"],
        ["Kubernetes API State", "row"],
      ]),
    );
  });

  test("uses durable range selectors for completed-run stat panels", async () => {
    const dashboard = await loadDashboard();

    const statExpressions = Object.fromEntries(
      dashboard.panels
        .filter((panel) => panel.type === "stat")
        .map((panel) => [panel.title, targetExpressions(panel)[0]]),
    );

    const dashboardFilters =
      'testid=~"$testid",run_class=~"$runClass",profile=~"$profile",surface=~"$surface",scenario=~"$scenario",cohort=~"$cohort",job_profile=~"$job_profile",namespace=~"$namespace",campaign_type=~"$campaignType"';

    expect(statExpressions).toMatchObject({
      "Cleanup Failures": `sum(last_over_time(k6_perfpulse_cleanup_failed_total{${dashboardFilters}}[$__range]))`,
      "Jobs Submitted": `sum(last_over_time(k6_perfpulse_jobs_submitted_total{${dashboardFilters}}[$__range]))`,
      "Jobs Visible": `sum(last_over_time(k6_perfpulse_jobs_visible_total{${dashboardFilters}}[$__range]))`,
      "Run Outcome": `sum(last_over_time(k6_perfpulse_jobs_visible_total{${dashboardFilters}}[$__range]))`,
    });
    expect(statExpressions["Run Outcome"]).not.toContain("or vector(0)");
    expect(Object.values(statExpressions).join("\n")).toContain('testid=~"$testid"');
    expect(Object.values(statExpressions).join("\n")).toContain("last_over_time(");
    expect(Object.values(statExpressions).join("\n")).not.toContain("increase(");
  });

  test("uses sparse completed-run histogram buckets for latency panels", async () => {
    const dashboard = await loadDashboard();

    const latencyExpressions = Object.fromEntries(
      dashboard.panels
        .filter((panel) =>
          [
            "Completion Latency",
            "Kueue Admission Latency",
            "Submission Latency",
            "Visibility Latency",
          ].includes(panel.title),
        )
        .map((panel) => [panel.title, targetExpressions(panel)]),
    );

    expect(Object.keys(latencyExpressions).sort()).toEqual([
      "Completion Latency",
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
    expect(allLatencyExpressions).not.toMatch(/_p(?:50|95|99)\b/);
  });

  test("uses regex matchers for multi-value template variables", async () => {
    const dashboard = await loadDashboard();
    const multiIncludeAllVariables = dashboard.templating.list.filter(
      (variable) => variable.multi && variable.includeAll && variable.allValue === ".*",
    );
    const promQl = [
      ...dashboard.panels.flatMap((panel) => targetExpressions(panel)),
      ...dashboard.templating.list.flatMap((variable) => [
        variable.definition ?? "",
        variable.query?.query ?? "",
      ]),
    ].join("\n");

    expect(multiIncludeAllVariables.map((variable) => variable.name)).toEqual([
      "testid",
      "runClass",
      "profile",
      "campaignType",
      "surface",
      "scenario",
      "cohort",
      "job_profile",
      "namespace",
      "request_name",
    ]);
    expect(promQl).toContain('testid=~"$testid"');
    expect(promQl).toContain('name=~"$request_name"');
    expect(promQl).not.toContain('testid="$testid"');
  });

  test("uses cron and campaign dashboard taxonomy without old run-class assumptions", async () => {
    const dashboard = await loadDashboard();
    const dashboardJson = JSON.stringify(dashboard);
    const variableNames = dashboard.templating.list.map((variable) => variable.name);
    const promQl = allPromQlExpressions(dashboard).join("\n");

    expect(variableNames).toContain("runClass");
    expect(variableNames).toContain("campaignType");
    expect(variableNames).not.toContain("run_class");
    expect(promQl).toContain('run_class=~"$runClass"');
    expect(promQl).toContain('campaign_type=~"$campaignType"');
    expect(promQl).toContain('profile=~"$profile"');
    expect(promQl).toContain('profile=~"cron|campaign"');
    expect(dashboardJson).not.toMatch(
      /spot|benchmark-small|benchmark-medium|stress-medium|stress-high/u,
    );
    expect(dashboardJson).not.toContain('run_class=~"$run_class"');
  });

  test("documents dashboard panels and template variables for operators", async () => {
    const dashboard = await loadDashboard();
    const panelDescriptions = Object.fromEntries(
      dashboard.panels.map((panel) => [panel.title, panel.description ?? ""]),
    );

    expect(dashboard.description?.trim()).not.toBe("");
    expect(dashboard.description).toContain("Submission latency is create request duration");
    expect(dashboard.description).toContain("start after the accepted create response");
    expect(panelDescriptions["Diagnosis Matrix"]).toContain("shown as one table");
    expect(panelDescriptions["Diagnosis Matrix"]).toContain("accepted create response");
    expect(panelDescriptions["Submission Latency"]).toContain(
      "measured from request start until the create response returns",
    );
    expect(panelDescriptions["Visibility Latency"]).toContain(
      "measured from accepted create response",
    );
    expect(panelDescriptions["Visibility Latency"]).toContain("excludes submission duration");
    expect(panelDescriptions["Completion Latency"]).toContain(
      "measured from accepted create response",
    );
    expect(panelDescriptions["Kueue Admission Latency"]).toContain(
      "measured from accepted create response",
    );
    expect(
      dashboard.panels.filter((panel) => !panel.description?.trim()).map((panel) => panel.title),
    ).toEqual([]);
    expect(
      dashboard.templating.list
        .filter((variable) => !variable.description?.trim())
        .map((variable) => variable.name),
    ).toEqual([]);
  });

  test("uses consistent readable timeseries styling and axis labels", async () => {
    const dashboard = await loadDashboard();
    const timeseriesPanels = dashboard.panels.filter((panel) => panel.type === "timeseries");

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
    const dashboard = await loadDashboard();
    const duplicateMatchers = allPromQlExpressions(dashboard).flatMap((expr) =>
      duplicateSelectorMatchers(expr),
    );

    expect(duplicateMatchers).toEqual([]);
  });

  test("uses truthful k6 check pass and failure rate signals", async () => {
    const dashboard = await loadDashboard();
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
    expect(joinedExpressions).not.toContain("/ clamp_min(");
    expect(joinedExpressions).not.toContain("clamp_min(");
    expect(joinedExpressions).toContain("+ 1e-12");
    expect(checksExpressions.every((expr) => expr.includes("sum(rate("))).toBe(true);
    expect(checksExpressions.every((expr) => expr.includes("[$__rate_interval]"))).toBe(true);
    expect(joinedExpressions).toContain('testid=~"$testid"');
    expect(joinedExpressions).toContain('surface=~"$surface"');
    expect(checksPanel?.targets?.map((target) => target.legendFormat)).toEqual([
      "checks passed",
      "checks failed",
    ]);
  });

  test("keeps diagnosis first and target-state logic surface aware", async () => {
    const dashboard = await loadDashboard();
    const firstPanel = dashboard.panels[0];
    if (firstPanel === undefined) {
      throw new Error("Dashboard has no panels");
    }
    const diagnosisExpressions = targetExpressions(firstPanel).join("\n");
    const targetStatePanel = dashboard.panels.find(
      (panel) => panel.title === "Target State Reached",
    );
    const targetStateExpressions = targetStatePanel
      ? targetExpressions(targetStatePanel).join("\n")
      : "";

    expect(firstPanel.title).toBe("Diagnosis Matrix");
    expect(firstPanel.type).toBe("table");
    expect(firstPanel.transformations).toEqual([{ id: "merge", options: {} }]);
    expect(displayNameOverrides(firstPanel)).toEqual([
      "Submitted",
      "Visible",
      "Target state",
      "Submit failed",
      "Visible failed",
      "Target failed",
      "Cleanup failed",
    ]);
    expect(diagnosisExpressions).toContain("sum by (surface)");
    expect(diagnosisExpressions).not.toContain("perfpulse_surface_expected");

    expect(diagnosisExpressions).toContain("k6_perfpulse_jobs_visible_total");
    expect(diagnosisExpressions).toContain("k6_perfpulse_jobs_visibility_failed_total");
    expect(diagnosisExpressions).not.toContain("k6_perfpulse_jobs_completed_total");
    expect(diagnosisExpressions).not.toContain("k6_perfpulse_kueue_workloads_admitted_total");
    expect(targetStateExpressions).toContain("k6_perfpulse_jobs_visible_total");
    expect(targetStateExpressions).toContain('surface=~"$surface"');
    expect(targetStateExpressions).not.toContain("k6_perfpulse_jobs_completed_total");
    expect(targetStateExpressions).not.toContain("k6_perfpulse_kueue_workloads_admitted_total");

    const targetStateFailuresPanel = dashboard.panels.find(
      (panel) => panel.title === "Target State Failures",
    );
    const targetStateFailureExpressions = targetStateFailuresPanel
      ? targetExpressions(targetStateFailuresPanel).join("\n")
      : "";

    expect(targetStateFailureExpressions).toContain(
      'k6_perfpulse_jobs_visibility_failed_total{testid=~"$testid",run_class=~"$runClass",profile=~"$profile",surface=~"$surface",scenario=~"$scenario",cohort=~"$cohort",job_profile=~"$job_profile",namespace=~"$namespace",campaign_type=~"$campaignType"}',
    );
    expect(targetStateFailureExpressions).not.toContain(
      "k6_perfpulse_jobs_completion_failed_total",
    );
    expect(targetStateFailureExpressions).not.toContain(
      "k6_perfpulse_kueue_workloads_admission_failed_total",
    );
  });

  test("uses a Prometheus-backed stat for no-data warnings", async () => {
    const dashboard = await loadDashboard();
    const noDataPanel = dashboard.panels.find((panel) => panel.title === "No Data Warning");
    const noDataExpression = noDataPanel ? targetExpressions(noDataPanel).join("\n") : "";

    expect(noDataPanel?.type).toBe("stat");
    expect(noDataPanel?.targets?.length).toBeGreaterThan(0);
    expect(noDataExpression).toContain("absent(");
    expect(noDataExpression).toContain("last_over_time(");
    expect(noDataExpression).toContain(
      'k6_perfpulse_jobs_submitted_total{testid=~"$testid",run_class=~"$runClass",profile=~"$profile",surface=~"$surface",scenario=~"$scenario",cohort=~"$cohort",job_profile=~"$job_profile",namespace=~"$namespace",campaign_type=~"$campaignType"}',
    );
    expect(noDataExpression).not.toContain('testid="$testid"');
    expect(JSON.stringify(noDataPanel?.options ?? {})).not.toContain("No PerfPulse series found");
    expect(noDataPanel?.fieldConfig?.defaults.thresholds?.steps).toContainEqual({
      color: "red",
      value: 1,
    });
  });

  test("includes k6 runtime, HTTP analytics, and best-effort cluster state rows", async () => {
    const dashboard = await loadDashboard();
    const expressionsByTitle = Object.fromEntries(
      dashboard.panels.map((panel) => [panel.title, targetExpressions(panel).join("\n")]),
    );

    expect(expressionsByTitle["Run Outcome Trend"]).toContain("sum by (testid, surface)");
    expect(expressionsByTitle["Dropped Iterations"]).toContain("k6_dropped_iterations_total");
    expect(expressionsByTitle.Iterations).toContain("k6_iterations_total");
    expect(expressionsByTitle["Virtual Users"]).toContain("k6_vus");
    expect(expressionsByTitle["HTTP Requests"]).toContain("k6_http_reqs_total");
    expect(expressionsByTitle["HTTP Failure Rate"]).toContain("k6_http_req_failed_total");
    expect(expressionsByTitle["HTTP Duration p95"]).toContain(
      "k6_http_req_duration_milliseconds_bucket",
    );
    expect(expressionsByTitle["HTTP Duration Heatmap"]).toContain(
      "k6_http_req_duration_milliseconds_bucket",
    );
    expect(expressionsByTitle["HTTP Duration p95"]).not.toContain("k6_http_req_duration_bucket");
    expect(expressionsByTitle["HTTP Duration Heatmap"]).not.toContain(
      "k6_http_req_duration_bucket",
    );
    expect(dashboard.panels.find((panel) => panel.title === "HTTP Duration Heatmap")?.type).toBe(
      "heatmap",
    );
    expect(expressionsByTitle["HTTP Requests"]).toContain(
      'testid=~"$testid",run_class=~"$runClass",profile=~"$profile",surface=~"$surface",scenario=~"$scenario",cohort=~"$cohort",job_profile=~"$job_profile",namespace=~"$namespace",campaign_type=~"$campaignType",name=~"$request_name"',
    );
    expect(expressionsByTitle["HTTP Duration Heatmap"]).toContain('name=~"$request_name"');
    expect(expressionsByTitle["Kueue Workloads Admitted"]).toContain(
      "sum by (cluster_queue) (kueue_admitted_workloads_total",
    );
    expect(expressionsByTitle["Kueue Workloads Admitted"]).not.toContain(
      "kueue_workloads_admitted",
    );
    expect(expressionsByTitle["Kueue Workloads Admitted"]).not.toContain('namespace=~"$namespace"');
    expect(expressionsByTitle["Kueue Workloads Pending"]).toContain(
      "sum by (cluster_queue, status) (kueue_pending_workloads",
    );
    expect(expressionsByTitle["Kueue Workloads Pending"]).not.toContain('namespace=~"$namespace"');
    expect(expressionsByTitle["Kueue Controller Restarts"]).toContain(
      "sum (increase(kube_pod_container_status_restarts_total",
    );
    expect(expressionsByTitle["Kueue Controller Restarts"]).not.toContain("sum by (pod)");
    expect(expressionsByTitle["API Server p95 Latency"]).toContain(
      "apiserver_request_duration_seconds_bucket",
    );
  });
});

async function loadDashboard(): Promise<Dashboard> {
  return JSON.parse(await Bun.file("docs/dashboards/perfpulse.json").text()) as Dashboard;
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
