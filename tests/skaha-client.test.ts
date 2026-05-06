import { describe, expect, test } from "bun:test";
import { type RunConfig, resolveRunConfig } from "../src/config";
import { metricTags } from "../src/metrics-contract";
import {
  createSkahaClient,
  runSkahaSurface,
  type SkahaHttpClientLike,
  type SkahaSurfaceClient,
  type SkahaSurfaceConfig,
} from "../src/skaha";

describe("Skaha user-facing surface client", () => {
  test("creates a headless session with bearer-token authentication", () => {
    const requests: RecordedRequest[] = [];
    const client = createSkahaClient({
      apiUrl: "https://ws.example/skaha/v1",
      http: recordRequests(requests),
      runConfig: skahaRunConfig(),
      token: "runtime-token",
    });

    const result = client.createSession({
      args: ["--cpu", "1", "--timeout", "10s", "--metrics-brief"],
      cmd: "stress-ng",
      cores: 1,
      env: { PERF_PULSE_TESTID: "spot-1" },
      image: "images.canfar.net/skaha/stress-ng:latest",
      name: "perfpulse-spot-1-0",
      ram: 1,
    });

    expect(result).toEqual({ accepted: true, sessionId: "session-abc", statusCode: 200 });
    expect(requests).toEqual([
      {
        body: "",
        method: "POST",
        options: {
          headers: {
            Accept: "application/json",
            Authorization: "Bearer runtime-token",
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Skaha-Authentication-Type": "RUNTIME-TOKEN",
          },
          tags: requestTags("skaha_create_session"),
          timeout: "30s",
        },
        url: "https://ws.example/skaha/v1/session?name=perfpulse-spot-1-0&image=images.canfar.net%2Fskaha%2Fstress-ng%3Alatest&type=headless&cores=1&ram=1&cmd=stress-ng&args=--cpu+1+--timeout+10s+--metrics-brief&env=PERF_PULSE_TESTID%3Dspot-1",
      },
    ]);
  });

  test("sends repeated env params and Skaha v1 minimum resource defaults on the POST URL", () => {
    const requests: RecordedRequest[] = [];
    const client = createSkahaClient({
      apiUrl: "https://ws.example/skaha/v1",
      http: recordRequests(requests),
      runConfig: skahaRunConfig(),
      token: "runtime-token",
    });

    client.createSession({
      args: ["--timeout", "10s"],
      cmd: "stress-ng",
      env: { PERF_PULSE_ATTEMPT: "0", PERF_PULSE_TESTID: "spot-1" },
      image: "images.canfar.net/skaha/stress-ng:latest",
      name: "perfpulse-spot-1-0",
    });

    const url = new URL(String(requests[0]?.url));
    expect(url.origin + url.pathname).toBe("https://ws.example/skaha/v1/session");
    expect(url.searchParams.get("cores")).toBe("1");
    expect(url.searchParams.get("ram")).toBe("1");
    expect(url.searchParams.getAll("env")).toEqual([
      "PERF_PULSE_ATTEMPT=0",
      "PERF_PULSE_TESTID=spot-1",
    ]);
  });

  test("sends Skaha create parameters as POST URL query params", () => {
    const requests: RecordedRequest[] = [];
    const client = createSkahaClient({
      apiUrl: "https://ws.example/skaha/v1",
      http: recordRequests(requests),
      runConfig: skahaRunConfig(),
      token: "runtime-token",
    });

    client.createSession({
      args: ["--cpu", "1", "--timeout", "10s", "--metrics-brief"],
      cmd: "stress-ng",
      env: { PERF_PULSE_TESTID: "spot-1" },
      image: "images.canfar.net/skaha/stress-ng:latest",
      name: "perfpulse-spot-1-0",
    });

    const url = new URL(String(requests[0]?.url));
    expect(url.origin + url.pathname).toBe("https://ws.example/skaha/v1/session");
    expect(requests[0]?.body).toBe("");
    expect(url.searchParams.get("type")).toBe("headless");
    expect(url.searchParams.get("cmd")).toBe("stress-ng");
    expect(url.searchParams.get("args")).toBe("--cpu 1 --timeout 10s --metrics-brief");
    expect(url.searchParams.getAll("env")).toEqual(["PERF_PULSE_TESTID=spot-1"]);
  });

  test("does not expose a cleanup session id when session creation fails", () => {
    const client = createSkahaClient({
      apiUrl: "https://ws.example/skaha/v1",
      http: recordRequests([], { postBody: "backend rejected session", postStatus: 500 }),
      runConfig: skahaRunConfig(),
      token: "runtime-token",
    });

    const result = client.createSession({
      args: ["--timeout", "10s"],
      cmd: "stress-ng",
      image: "images.canfar.net/skaha/stress-ng:latest",
      name: "perfpulse-spot-1-0",
    });

    expect(result).toEqual({ accepted: false, statusCode: 500 });
    expect(JSON.stringify(result)).not.toContain("backend rejected session");
  });

  test("uses the configured Skaha request timeout for create, read, and cleanup calls", () => {
    const requests: RecordedRequest[] = [];
    const client = createSkahaClient({
      apiUrl: "https://ws.example/skaha/v1",
      http: recordRequests(requests),
      runConfig: skahaRunConfig({ SKAHA_REQUEST_TIMEOUT_SECONDS: "120" }),
      token: "runtime-token",
    });

    client.createSession({
      args: ["--timeout", "10s"],
      cmd: "stress-ng",
      image: "images.canfar.net/skaha/stress-ng:latest",
      name: "perfpulse-spot-1-0",
    });
    client.getSession("session-abc");
    client.deleteSession("session-abc");

    expect(requests.map((request) => request.options)).toEqual([
      expect.objectContaining({ timeout: "120s" }),
      expect.objectContaining({ timeout: "120s" }),
      expect.objectContaining({ timeout: "120s" }),
    ]);
  });

  test("sends optional registry auth on create, read, and cleanup calls", () => {
    const requests: RecordedRequest[] = [];
    const client = createSkahaClient({
      apiUrl: "https://ws.example/skaha/v1",
      http: recordRequests(requests),
      registryAuthHeader: "dXNlcjpzZWNyZXQ=",
      runConfig: skahaRunConfig(),
      token: "runtime-token",
    });

    client.createSession({
      args: ["--timeout", "10s"],
      cmd: "stress-ng",
      image: "images.canfar.net/skaha/stress-ng:latest",
      name: "perfpulse-spot-1-0",
    });
    client.getSession("session-abc");
    client.deleteSession("session-abc");

    expect(requests.map((request) => request.options)).toEqual([
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Skaha-Registry-Auth": "dXNlcjpzZWNyZXQ=",
        }),
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Skaha-Registry-Auth": "dXNlcjpzZWNyZXQ=",
        }),
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Skaha-Registry-Auth": "dXNlcjpzZWNyZXQ=",
        }),
      }),
    ]);
  });

  test("polls a session by id with stable request tags and recognized status", () => {
    const requests: RecordedRequest[] = [];
    const client = createSkahaClient({
      apiUrl: "https://ws.example/skaha/v1",
      http: recordRequests(requests),
      runConfig: skahaRunConfig(),
      token: "runtime-token",
    });

    const result = client.getSession("session-abc");

    expect(result).toEqual({
      found: true,
      session: { id: "session-abc", status: "Running" },
      status: "Running",
      statusCode: 200,
    });
    expect(requests).toEqual([
      {
        method: "GET",
        options: {
          headers: {
            Accept: "application/json",
            Authorization: "Bearer runtime-token",
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Skaha-Authentication-Type": "RUNTIME-TOKEN",
          },
          tags: requestTags("skaha_get_session"),
          timeout: "30s",
        },
        url: "https://ws.example/skaha/v1/session/session-abc",
      },
    ]);
  });

  test("treats pending or running status as visibility but not spot completion", () => {
    const config = skahaSurfaceConfig();
    const client: SkahaSurfaceClient = {
      createSession() {
        return { accepted: true, sessionId: "session-abc", statusCode: 200 };
      },
      deleteSession() {
        throw new Error("cleanup is not part of runSkahaSurface");
      },
      getSession() {
        return {
          found: true,
          session: { id: "session-abc", status: "Running" },
          status: "Running",
          statusCode: 200,
        };
      },
    };

    const result = runSkahaSurface(
      config,
      client,
      (_timeout, _interval, read) => read(),
      () => 10,
    );

    expect(result.visible).toBe(true);
    expect(result.completed).toBe(false);
    expect(result.failure).toEqual({
      message: "Skaha session did not reach Succeeded or Completed within 120s",
      stage: "completion",
    });
  });

  test("succeeds when a visible session reaches Succeeded within the completion gate", () => {
    const config = skahaSurfaceConfig();
    const statuses: Array<"Pending" | "Succeeded"> = ["Pending", "Succeeded"];
    const client: SkahaSurfaceClient = {
      createSession() {
        return { accepted: true, sessionId: "session-abc", statusCode: 200 };
      },
      deleteSession() {
        throw new Error("cleanup is not part of runSkahaSurface");
      },
      getSession() {
        const status = statuses.shift() ?? "Succeeded";
        return {
          found: true,
          session: { id: "session-abc", status },
          status,
          statusCode: 200,
        };
      },
    };
    const timestamps = [0, 100, 250, 600];

    const result = runSkahaSurface(
      config,
      client,
      (_timeout, _interval, read) => read(),
      () => timestamps.shift() ?? 600,
    );

    expect(result.failure).toBeUndefined();
    expect(result.submissionDurationMs).toBe(100);
    expect(result.visible).toBe(true);
    expect(result.completed).toBe(true);
    expect(result.visibilityLatencyMs).toBe(150);
    expect(result.completionLatencyMs).toBe(500);
  });

  test("deletes sessions with explicit cleanup results and stable metric tags", () => {
    const requests: RecordedRequest[] = [];
    const client = createSkahaClient({
      apiUrl: "https://ws.example/skaha/v1/",
      http: recordRequests(requests, { deleteStatus: 404 }),
      runConfig: skahaRunConfig(),
      token: "runtime-token",
    });

    const result = client.deleteSession("raw-session-id");

    expect(result).toEqual({
      cleanupSucceeded: true,
      deleted: false,
      statusCode: 404,
    });
    expect(JSON.stringify(result)).not.toContain("raw-session-id");
    expect(requests[0]?.options).toMatchObject({
      tags: requestTags("skaha_delete_session"),
    });
  });

  test("returns a bounded cleanup failure without raw identifiers", () => {
    const client = createSkahaClient({
      apiUrl: "https://ws.example/skaha/v1",
      http: recordRequests([], { deleteStatus: 500 }),
      runConfig: skahaRunConfig(),
      token: "runtime-token",
    });

    const result = client.deleteSession("raw-session-id");

    expect(result).toEqual({
      cleanupSucceeded: false,
      deleted: false,
      failure: "cleanup_failed",
      statusCode: 500,
    });
    expect(JSON.stringify(result)).not.toContain("raw-session-id");
  });
});

interface RecordedRequest {
  body?: string | null;
  method: string;
  options?: unknown;
  url: string;
}

function recordRequests(
  requests: RecordedRequest[],
  behavior: { deleteStatus?: number; postBody?: string; postStatus?: number } = {},
): SkahaHttpClientLike {
  return {
    del(url, body, requestOptions) {
      requests.push({ body, method: "DELETE", options: requestOptions, url });
      return { body: "", status: behavior.deleteStatus ?? 202 };
    },
    get(url, options) {
      requests.push({ method: "GET", options, url });
      return { body: JSON.stringify({ id: "session-abc", status: "Running" }), status: 200 };
    },
    post(url, body, options) {
      requests.push({ body, method: "POST", options, url });
      return { body: behavior.postBody ?? "session-abc\n", status: behavior.postStatus ?? 200 };
    },
  };
}

function skahaRunConfig(env: Record<string, string> = {}): RunConfig {
  return resolveRunConfig({ SURFACE: "skaha", TESTID: "skaha-spot", ...env });
}

function requestTags(name: string): { name: string } & ReturnType<typeof metricTags> {
  return { name, ...metricTags(skahaRunConfig()) };
}

function skahaSurfaceConfig(): SkahaSurfaceConfig {
  return {
    completionGateSeconds: 120,
    pollIntervalSeconds: 2,
    session: {
      args: ["--cpu", "1", "--timeout", "10s", "--metrics-brief"],
      cmd: "stress-ng",
      image: "images.canfar.net/skaha/stress-ng:latest",
      name: "perfpulse-spot-1-0",
    },
    visibilityGateSeconds: 60,
  };
}
