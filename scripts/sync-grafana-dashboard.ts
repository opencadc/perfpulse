/**
 * Normalize the repo-managed PerfPulse dashboard artifacts and optionally prepare them for manual
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

const dashboardSpecs = [
  {
    path: "docs/dashboards/perfpulse-cron.json",
    title: "PerfPulse Cron Health",
    uid: "perfpulse-cron",
    tags: ["perfpulse", "cron"],
  },
  {
    path: "docs/dashboards/perfpulse-campaign.json",
    title: "PerfPulse Campaign Evidence",
    uid: "perfpulse-campaign",
    tags: ["perfpulse", "campaign"],
  },
] as const;

for (const spec of dashboardSpecs) {
  const dashboard = JSON.parse(await Bun.file(spec.path).text()) as Dashboard;
  dashboard.id = null;
  dashboard.refresh = "1m";
  dashboard.tags = [...spec.tags];
  dashboard.title = spec.title;
  dashboard.uid = spec.uid;
  dashboard.version = 1;

  await Bun.write(spec.path, `${JSON.stringify(dashboard, null, 2)}\n`);
  console.log(`Updated ${spec.path}`);
}

if (publish) {
  console.log(
    "Serve a specific dashboard payload with bun scripts/serve-dashboard-payload.ts [cron|campaign].",
  );
}

export {};
