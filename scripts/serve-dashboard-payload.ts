import dashboard from "../docs/dashboards/perfpulse.json";

const publishedDashboard = {
  ...dashboard,
  id: Number(process.env.GRAFANA_DASHBOARD_ID ?? "0"),
  version: Number(process.env.GRAFANA_DASHBOARD_VERSION ?? "1"),
};

const payload = {
  dashboard: publishedDashboard,
  folderUid: undefined,
  overwrite: true,
  message: "PerfPulse dashboard update",
};

const server = Bun.serve({
  port: 8765,
  fetch() {
    return Response.json(payload);
  },
});

console.log(`Serving PerfPulse dashboard payload on http://localhost:${server.port}`);
