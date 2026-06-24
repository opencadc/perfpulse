/**
 * Normalize the repo-managed PerfPulse dashboard artifact and optionally prepare it for manual
 * Grafana publishing.
 *
 * Run: bun scripts/sync-grafana-dashboard.ts [--publish]
 */
const publish = process.argv.includes("--publish");

type Dashboard = {
  description?: string;
  id?: number | null;
  refresh?: string;
  tags?: string[];
  title: string;
  uid: string;
  version?: number;
};

const dashboardPath = "docs/dashboards/perfpulse.json";
const dashboard = JSON.parse(await Bun.file(dashboardPath).text()) as Dashboard;
dashboard.id = null;
dashboard.refresh = "1m";
dashboard.tags = ["perfpulse", "canfar", "cron", "benchmark"];
dashboard.title = "PerfPulse";
dashboard.uid = "perfpulse";
dashboard.version = 1;

await Bun.write(dashboardPath, `${JSON.stringify(dashboard, null, 2)}\n`);
console.log(`Updated ${dashboardPath}`);

if (publish) {
  console.log("Serve the dashboard payload with bun scripts/serve-dashboard-payload.ts.");
}

export {};
