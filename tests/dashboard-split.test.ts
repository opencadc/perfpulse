import { describe, expect, test } from "bun:test";

const dashboardFilters =
  'testid=~"$testid",run_class=~"$runClass",surface=~"$surface",scenario=~"$scenario",namespace=~"$namespace"';

describe("split Grafana dashboard artifacts", () => {
  test("ships a cron health dashboard without campaign testid drilldown", async () => {
    const dashboard = await loadDashboard("docs/dashboards/perfpulse-cron.json");

    expect(dashboard.uid).toBe("perfpulse-cron");
    expect(dashboard.title).toContain("Cron");
    expect(dashboard.tags).toContain("perfpulse");
    expect(variableNames(dashboard)).not.toContain("testid");
    expect(variableNames(dashboard)).not.toContain("campaignType");
    expect(panelTitles(dashboard)).toEqual(
      expect.arrayContaining([
        "Cron Direct OK",
        "Cron Kueue OK",
        "Cron Skaha OK",
        "Cron Health Trend",
      ]),
    );
    expect(panelTitles(dashboard)).not.toContain("Diagnosis Matrix");
  });

  test("ships a campaign drilldown dashboard with testid filtering", async () => {
    const dashboard = await loadDashboard("docs/dashboards/perfpulse-campaign.json");

    expect(dashboard.uid).toBe("perfpulse-campaign");
    expect(dashboard.title).toContain("Campaign");
    expect(variableNames(dashboard)).toEqual(
      expect.arrayContaining(["testid", "runClass", "surface"]),
    );
    expect(variableNames(dashboard)).not.toContain("campaignType");
    expect(panelTitles(dashboard)).toEqual(
      expect.arrayContaining(["Expected Jobs", "Surface Lifecycle Trend", "Target State Reached"]),
    );
    expect(allPromQl(dashboard).join("\n")).toContain(dashboardFilters);
  });

  test("retires the monolithic overview dashboard artifact", async () => {
    expect(await Bun.file("docs/dashboards/perfpulse.json").exists()).toBe(false);
  });
});

async function loadDashboard(path: string): Promise<Dashboard> {
  return JSON.parse(await Bun.file(path).text()) as Dashboard;
}

function variableNames(dashboard: Dashboard): string[] {
  return dashboard.templating.list.map((variable) => variable.name);
}

function panelTitles(dashboard: Dashboard): string[] {
  return dashboard.panels.map((panel) => panel.title);
}

function allPromQl(dashboard: Dashboard): string[] {
  return [
    ...dashboard.panels.flatMap((panel) =>
      (panel.targets ?? []).map((target) => target.expr ?? ""),
    ),
    ...dashboard.templating.list.flatMap((variable) => [
      variable.definition ?? "",
      variable.query?.query ?? "",
    ]),
  ].filter((expr) => expr !== "");
}

type Dashboard = {
  panels: Array<{ title: string; targets?: Array<{ expr?: string }> }>;
  tags: string[];
  templating: { list: Array<{ name: string; definition?: string; query?: { query?: string } }> };
  title: string;
  uid: string;
};
