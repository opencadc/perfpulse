import { describe, expect, test } from "bun:test";
import {
  createSkahaClient,
  runSkahaSurface,
  type SkahaHttpClientLike,
  type SkahaSurfaceClient,
  type SkahaSurfaceConfig,
} from "../src/skaha";

describe("Skaha user-facing surface client", () => {
  test("creates a headless session with runtime-token form authentication", () => {
    const requests: RecordedRequest[] = [];
    const client = createSkahaClient({
      apiUrl: "https://ws.example/skaha/v1",
      http: recordRequests(requests),
      token: "runtime-secret",
    });

    const result = client.createSession({
      args: ["--cpu", "1", "--timeout", "10s", "--metrics-brief"],
      cmd: "stress-ng",
      cores: 1,
      env: { PERF_PULSE_TESTID: "spot-1" },
      image: "docker.io/alexeiled/stress-ng",
      name: "perfpulse-spot-1-0",
      ram: 1,
    });

    expect(result).toEqual({ accepted: true, sessionId: "session-abc", statusCode: 200 });
    expect(requests).toEqual([
      {
        body: "name=perfpulse-spot-1-0&image=docker.io%2Falexeiled%2Fstress-ng&type=headless&cores=1&ram=1&cmd=stress-ng&args=--cpu+1+--timeout+10s+--metrics-brief&env=PERF_PULSE_TESTID%3Dspot-1",
        method: "POST",
        options: {
          headers: {
            Accept: "application/json",
            Authorization: "Bearer runtime-secret",
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Skaha-Authentication-Type": "RUNTIME-TOKEN",
          },
          tags: { name: "skaha_create_session" },
          timeout: "30s",
        },
        url: "https://ws.example/skaha/v1/session",
      },
    ]);
  });

  test("uses Skaha v1 minimum resource defaults when cores and ram are omitted", () => {
    const requests: RecordedRequest[] = [];
    const client = createSkahaClient({
      apiUrl: "https://ws.example/skaha/v1",
      http: recordRequests(requests),
      token: "runtime-secret",
    });

    client.createSession({
      args: ["--timeout", "10s"],
      cmd: "stress-ng",
      image: "docker.io/alexeiled/stress-ng",
      name: "perfpulse-spot-1-0",
    });

    expect(new URLSearchParams(requests[0]?.body ?? "").get("cores")).toBe("1");
    expect(new URLSearchParams(requests[0]?.body ?? "").get("ram")).toBe("1");
  });

  test("polls a session by id with stable request tags and recognized status", () => {
    const requests: RecordedRequest[] = [];
    const client = createSkahaClient({
      apiUrl: "https://ws.example/skaha/v1",
      http: recordRequests(requests),
      token: "runtime-secret",
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
            Authorization: "Bearer runtime-secret",
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Skaha-Authentication-Type": "RUNTIME-TOKEN",
          },
          tags: { name: "skaha_get_session" },
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
      message: "Skaha session did not reach Completed within 120s",
      stage: "completion",
    });
  });

  test("succeeds when a visible session reaches Completed within the completion gate", () => {
    const config = skahaSurfaceConfig();
    const statuses: Array<"Pending" | "Completed"> = ["Pending", "Completed"];
    const client: SkahaSurfaceClient = {
      createSession() {
        return { accepted: true, sessionId: "session-abc", statusCode: 200 };
      },
      deleteSession() {
        throw new Error("cleanup is not part of runSkahaSurface");
      },
      getSession() {
        const status = statuses.shift() ?? "Completed";
        return {
          found: true,
          session: { id: "session-abc", status },
          status,
          statusCode: 200,
        };
      },
    };
    let clock = 0;

    const result = runSkahaSurface(
      config,
      client,
      (_timeout, _interval, read) => read(),
      () => {
        clock += 25;
        return clock;
      },
    );

    expect(result.failure).toBeUndefined();
    expect(result.visible).toBe(true);
    expect(result.completed).toBe(true);
    expect(result.visibilityLatencyMs).toBe(50);
    expect(result.completionLatencyMs).toBe(75);
  });

  test("deletes sessions with explicit cleanup results and stable metric tags", () => {
    const requests: RecordedRequest[] = [];
    const client = createSkahaClient({
      apiUrl: "https://ws.example/skaha/v1/",
      http: recordRequests(requests, { deleteStatus: 404 }),
      token: "runtime-secret",
    });

    const result = client.deleteSession("raw-session-id");

    expect(result).toEqual({
      cleanupSucceeded: true,
      deleted: false,
      statusCode: 404,
    });
    expect(JSON.stringify(result)).not.toContain("raw-session-id");
    expect(JSON.stringify(result)).not.toContain("runtime-secret");
    expect(requests[0]?.options).toMatchObject({
      tags: { name: "skaha_delete_session" },
    });
  });

  test("returns a bounded cleanup failure without raw identifiers", () => {
    const client = createSkahaClient({
      apiUrl: "https://ws.example/skaha/v1",
      http: recordRequests([], { deleteStatus: 500 }),
      token: "runtime-secret",
    });

    const result = client.deleteSession("raw-session-id");

    expect(result).toEqual({
      cleanupSucceeded: false,
      deleted: false,
      failure: "cleanup_failed",
      statusCode: 500,
    });
    expect(JSON.stringify(result)).not.toContain("raw-session-id");
    expect(JSON.stringify(result)).not.toContain("runtime-secret");
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
  behavior: { deleteStatus?: number } = {},
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
      return { body: "session-abc\n", status: 200 };
    },
  };
}

function skahaSurfaceConfig(): SkahaSurfaceConfig {
  return {
    completionGateSeconds: 120,
    pollIntervalSeconds: 2,
    session: {
      args: ["--cpu", "1", "--timeout", "10s", "--metrics-brief"],
      cmd: "stress-ng",
      image: "docker.io/alexeiled/stress-ng",
      name: "perfpulse-spot-1-0",
    },
    visibilityGateSeconds: 60,
  };
}
