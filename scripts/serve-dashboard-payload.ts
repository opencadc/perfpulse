import campaignDashboard from "../docs/dashboards/perfpulse-campaign.json";
import cronDashboard from "../docs/dashboards/perfpulse-cron.json";

const selectedDashboard = process.argv[2] === "campaign" ? "campaign" : "cron";
const dashboard =
  selectedDashboard === "campaign"
    ? {
        ...campaignDashboard,
        id: Number(process.env.GRAFANA_CAMPAIGN_DASHBOARD_ID ?? "0"),
        version: Number(process.env.GRAFANA_CAMPAIGN_DASHBOARD_VERSION ?? "1"),
      }
    : {
        ...cronDashboard,
        id: Number(process.env.GRAFANA_CRON_DASHBOARD_ID ?? "0"),
        version: Number(process.env.GRAFANA_CRON_DASHBOARD_VERSION ?? "1"),
      };

const payload = {
  dashboard,
  folderUid: undefined,
  overwrite: true,
  message: `PerfPulse ${selectedDashboard} dashboard update`,
};

const server = Bun.serve({
  port: 8765,
  fetch() {
    return Response.json(payload);
  },
});

console.log(`Serving ${selectedDashboard} dashboard payload on http://localhost:${server.port}`);
