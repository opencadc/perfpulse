import { mock } from "bun:test";
import { KUBERNETES_LABEL_KEYS } from "../../src/labels";

export interface MetricRecord {
  metric: string;
  tags?: Record<string, string> | undefined;
  value: number;
}

export interface HttpRequest {
  body?: string | null;
  method: string;
  options?:
    | {
        headers?: Record<string, string>;
        tags?: {
          name?: string;
        } & Record<string, string>;
      }
    | undefined;
  url: string;
}

export interface CheckCall {
  checks: Record<string, boolean>;
  subject: unknown;
}

export const runtimeHarness = {
  checkCalls: [] as CheckCall[],
  createdJobs: [] as Array<{ labels?: Record<string, string>; name: string }>,
  deleteStatuses: [] as number[],
  groupCalls: [] as string[],
  httpRequests: [] as HttpRequest[],
  iterationInTest: 0,
  jobActive: 0,
  jobConditionType: "Complete" as "Complete" | "Failed" | undefined,
  listJobsStatus: undefined as number | undefined,
  listJobsReturnEmpty: false,
  metricRecords: [] as MetricRecord[],
  runtimeEvents: [] as string[],
  sessionGetStatuses: [] as number[],
  sessionStatus: "Completed",
  skahaSessionCounter: 0,
  sleepCalls: [] as number[],
  vuIdInTest: 1,
  workloadAdmitted: true,
};

export const metricRecords = runtimeHarness.metricRecords;
export const httpRequests = runtimeHarness.httpRequests;
export const createdJobs = runtimeHarness.createdJobs;
export const runtimeEvents = runtimeHarness.runtimeEvents;
export const sleepCalls = runtimeHarness.sleepCalls;
export const deleteStatuses = runtimeHarness.deleteStatuses;
export const sessionGetStatuses = runtimeHarness.sessionGetStatuses;

export function resetK6RuntimeHarness(): void {
  runtimeHarness.checkCalls.length = 0;
  runtimeHarness.groupCalls.length = 0;
  runtimeHarness.httpRequests.length = 0;
  runtimeHarness.metricRecords.length = 0;
  runtimeHarness.createdJobs.length = 0;
  runtimeHarness.runtimeEvents.length = 0;
  runtimeHarness.sleepCalls.length = 0;
  runtimeHarness.deleteStatuses.length = 0;
  runtimeHarness.sessionGetStatuses.length = 0;
  runtimeHarness.listJobsStatus = undefined;
  runtimeHarness.listJobsReturnEmpty = false;
  runtimeHarness.iterationInTest = 0;
  runtimeHarness.jobActive = 0;
  runtimeHarness.vuIdInTest = 1;
  runtimeHarness.workloadAdmitted = true;
  runtimeHarness.jobConditionType = "Complete";
  runtimeHarness.sessionStatus = "Completed";
  runtimeHarness.skahaSessionCounter = 0;
}

Reflect.set(globalThis, "__ENV", {
  PERF_PULSE_CLIENT_MODE: "kubernetes",
  RUN_CLASS: "cron",
  SKAHA_API_URL: "https://ws.example/skaha/v1",
  SKAHA_PASSWORD_PATH: "/var/run/secrets/perfpulse/skaha-auth/password",
  SKAHA_USERNAME_PATH: "/var/run/secrets/perfpulse/skaha-auth/username",
  SURFACE: "skaha",
  TESTID: "skaha-spot",
});
Reflect.set(globalThis, "open", (path: string) => {
  if (path.endsWith("/username")) {
    return "runtime-user\n";
  }
  if (path.endsWith("/password")) {
    return " runtime-password ";
  }
  return "service-account-token\n";
});

mock.module("k6", () => ({
  check(subject: unknown, checks: Record<string, (value: unknown) => boolean>) {
    const results = Object.fromEntries(
      Object.entries(checks).map(([name, predicate]) => [name, predicate(subject)]),
    );
    runtimeHarness.checkCalls.push({ checks: results, subject });
    return Object.values(results).every(Boolean);
  },
  fail: (message: string) => {
    throw new Error(message);
  },
  group(name: string, fn: () => unknown) {
    runtimeHarness.groupCalls.push(name);
    return fn();
  },
  sleep: (seconds: number) => {
    runtimeHarness.sleepCalls.push(seconds);
    runtimeHarness.runtimeEvents.push("sleep");
  },
}));

mock.module("k6/metrics", () => ({
  Counter: class Counter {
    readonly name: string;

    constructor(name: string) {
      this.name = name;
    }

    add(value: number, tags?: Record<string, string>): void {
      runtimeHarness.metricRecords.push({ metric: this.name, tags, value });
    }
  },
  Gauge: class Gauge {
    readonly name: string;

    constructor(name: string) {
      this.name = name;
    }

    add(value: number, tags?: Record<string, string>): void {
      runtimeHarness.metricRecords.push({ metric: this.name, tags, value });
    }
  },
  Trend: class Trend {
    readonly name: string;

    constructor(name: string) {
      this.name = name;
    }

    add(value: number, tags?: Record<string, string>): void {
      runtimeHarness.metricRecords.push({ metric: this.name, tags, value });
    }
  },
}));

mock.module("k6/http", () => ({
  default: {
    del(url: string, body: string | null, options?: HttpRequest["options"]) {
      runtimeHarness.httpRequests.push({ body, method: "DELETE", options, url });
      return { body: "", status: runtimeHarness.deleteStatuses.shift() ?? 202 };
    },
    get(url: string, options?: HttpRequest["options"]) {
      runtimeHarness.httpRequests.push({ method: "GET", options, url });
      if (url.includes("/session/")) {
        const status = runtimeHarness.sessionGetStatuses.shift() ?? 200;
        return {
          body:
            status === 200
              ? JSON.stringify({ id: "session-runtime", status: runtimeHarness.sessionStatus })
              : "",
          status,
        };
      }
      if (url.includes("/apis/kueue.x-k8s.io/")) {
        const jobName = runtimeHarness.createdJobs.at(-1)?.name ?? "perfpulse-kueue-spot-kueue-0";
        return {
          body: JSON.stringify({
            items: [
              {
                metadata: {
                  ownerReferences: [{ kind: "Job", name: jobName }],
                },
                status: {
                  conditions: [
                    {
                      status: runtimeHarness.workloadAdmitted ? "True" : "False",
                      type: "Admitted",
                    },
                  ],
                },
              },
            ],
          }),
          status: 200,
        };
      }
      if (runtimeHarness.listJobsReturnEmpty) {
        return { body: JSON.stringify({ items: [] }), status: 200 };
      }
      if (runtimeHarness.listJobsStatus !== undefined) {
        return { body: "list refused", status: runtimeHarness.listJobsStatus };
      }
      const jobs =
        runtimeHarness.createdJobs.length > 0
          ? runtimeHarness.createdJobs
          : [
              {
                labels: { [KUBERNETES_LABEL_KEYS.surface]: "k8s-kueue" },
                name: "perfpulse-kueue-spot-kueue-0",
              },
            ];
      return {
        body: JSON.stringify({
          items: jobs.map((job) => ({
            metadata: { labels: job.labels, name: job.name },
            status: {
              ...(runtimeHarness.jobActive > 0 ? { active: runtimeHarness.jobActive } : {}),
              conditions:
                runtimeHarness.jobConditionType === undefined
                  ? []
                  : [{ status: "True", type: runtimeHarness.jobConditionType }],
            },
          })),
        }),
        status: 200,
      };
    },
    post(url: string, body: string, options?: HttpRequest["options"]) {
      runtimeHarness.httpRequests.push({ body, method: "POST", options, url });
      if (url === "https://ws-cadc.canfar.net/ac/login") {
        return { body: JSON.stringify("runtime-token"), status: 200 };
      }
      if (url.includes("/session?")) {
        runtimeHarness.runtimeEvents.push("skaha_create_session");
        const sessionId = `session-runtime-${runtimeHarness.skahaSessionCounter}`;
        runtimeHarness.skahaSessionCounter += 1;
        return { body: sessionId, status: 200 };
      }
      const manifest = JSON.parse(body);
      runtimeHarness.createdJobs.push({
        labels: manifest.metadata.labels,
        name: manifest.metadata.name,
      });
      return { body: "created", status: 201 };
    },
  },
}));

mock.module("k6/execution", () => ({
  scenario: {
    get iterationInTest() {
      return runtimeHarness.iterationInTest;
    },
  },
  vu: {
    get idInTest() {
      return runtimeHarness.vuIdInTest;
    },
  },
}));

mock.module("k6/encoding", () => ({
  b64encode(input: string) {
    return Buffer.from(input, "utf8").toString("base64");
  },
}));
