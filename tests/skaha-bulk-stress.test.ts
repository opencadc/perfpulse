import { describe, expect, test } from "bun:test";
import {
  runBulkSkahaStressSurface,
  type SkahaBulkStressConfig,
  type SkahaCreateSessionParams,
  type SkahaSurfaceClient,
} from "../src/skaha";

describe("runBulkSkahaStressSurface", () => {
  test("submits a small batch, polls round-robin, and deletes terminal sessions", () => {
    const requests: BulkRequest[] = [];
    const lifecycleEvents: Array<[string, number | string | undefined]> = [];
    const sessionStatuses = new Map<string, Array<"Pending" | "Succeeded">>([
      ["session-0", ["Pending", "Succeeded"]],
      ["session-1", ["Pending", "Succeeded"]],
      ["session-2", ["Pending", "Succeeded"]],
    ]);
    const client = mockBulkClient(requests, sessionStatuses);
    let nowMs = 0;

    const result = runBulkSkahaStressSurface(
      bulkStressConfig(3),
      client,
      lifecycleRecorder(lifecycleEvents),
      {
        now: () => nowMs,
        sleep: (seconds) => {
          nowMs += seconds * 1000;
        },
      },
    );

    expect(result.succeeded).toBe(true);
    expect(result.failure).toBeUndefined();
    expect(result.sessions).toEqual([
      {
        cleanedUp: true,
        completed: true,
        sessionId: "session-0",
        submitted: true,
        terminalFailure: false,
        visible: true,
      },
      {
        cleanedUp: true,
        completed: true,
        sessionId: "session-1",
        submitted: true,
        terminalFailure: false,
        visible: true,
      },
      {
        cleanedUp: true,
        completed: true,
        sessionId: "session-2",
        submitted: true,
        terminalFailure: false,
        visible: true,
      },
    ]);
    expect(requests).toEqual([
      { method: "POST", sessionId: "session-0" },
      { method: "POST", sessionId: "session-1" },
      { method: "POST", sessionId: "session-2" },
      { method: "GET", sessionId: "session-0" },
      { method: "GET", sessionId: "session-1" },
      { method: "GET", sessionId: "session-2" },
      { method: "GET", sessionId: "session-0" },
      { method: "DELETE", sessionId: "session-0" },
      { method: "GET", sessionId: "session-1" },
      { method: "DELETE", sessionId: "session-1" },
      { method: "GET", sessionId: "session-2" },
      { method: "DELETE", sessionId: "session-2" },
    ]);
    expect(lifecycleEvents).toEqual([
      ["submitted", 0],
      ["submitted", 0],
      ["submitted", 0],
      ["visible", 0],
      ["visible", 0],
      ["visible", 0],
      ["completed", 0],
      ["completed", 0],
      ["completed", 0],
    ]);
  });

  test("continues the batch when a session reaches a failed terminal status", () => {
    const requests: BulkRequest[] = [];
    const lifecycleEvents: Array<[string, number | string | undefined]> = [];
    const sessionStatuses = new Map<string, Array<"Failed" | "Pending" | "Succeeded">>([
      ["session-0", ["Pending", "Succeeded"]],
      ["session-1", ["Failed"]],
      ["session-2", ["Pending", "Succeeded"]],
    ]);
    const client = mockBulkClient(requests, sessionStatuses);
    let nowMs = 0;

    const result = runBulkSkahaStressSurface(
      bulkStressConfig(3),
      client,
      lifecycleRecorder(lifecycleEvents),
      {
        now: () => nowMs,
        sleep: (seconds) => {
          nowMs += seconds * 1000;
        },
      },
    );

    expect(result.succeeded).toBe(true);
    expect(result.failure).toBeUndefined();
    expect(result.sessions).toEqual([
      {
        cleanedUp: true,
        completed: true,
        sessionId: "session-0",
        submitted: true,
        terminalFailure: false,
        visible: true,
      },
      {
        cleanedUp: true,
        completed: true,
        sessionId: "session-1",
        submitted: true,
        terminalFailure: true,
        visible: false,
      },
      {
        cleanedUp: true,
        completed: true,
        sessionId: "session-2",
        submitted: true,
        terminalFailure: false,
        visible: true,
      },
    ]);
    expect(requests.map((request) => `${request.method}:${request.sessionId}`)).toEqual([
      "POST:session-0",
      "POST:session-1",
      "POST:session-2",
      "GET:session-0",
      "GET:session-1",
      "DELETE:session-1",
      "GET:session-0",
      "DELETE:session-0",
      "GET:session-2",
      "GET:session-2",
      "DELETE:session-2",
    ]);
    expect(lifecycleEvents).toEqual([
      ["submitted", 0],
      ["submitted", 0],
      ["submitted", 0],
      ["visible", 0],
      ["failure", "completion"],
      ["completed", 0],
      ["visible", 0],
      ["completed", 0],
    ]);
  });

  test("fails the batch when sessions do not complete before the completion gate", () => {
    const requests: BulkRequest[] = [];
    const lifecycleEvents: Array<[string, number | string | undefined]> = [];
    const sessionStatuses = new Map<string, Array<"Running">>([
      ["session-0", ["Running"]],
      ["session-1", ["Running"]],
      ["session-2", ["Running"]],
    ]);
    const client = mockBulkClient(requests, sessionStatuses);
    let nowMs = 0;

    const result = runBulkSkahaStressSurface(
      {
        ...bulkStressConfig(3),
        completionTimeoutSeconds: 2,
        pollCycleSeconds: 1,
        pollMinSeconds: 0,
      },
      client,
      lifecycleRecorder(lifecycleEvents),
      {
        now: () => nowMs,
        sleep: (seconds) => {
          nowMs += seconds * 1000;
        },
      },
    );

    expect(result.succeeded).toBe(false);
    expect(result.failure).toEqual({
      message: "Skaha bulk stress batch did not complete within 2s",
      stage: "completion",
    });
    expect(result.sessions).toEqual([
      {
        cleanedUp: false,
        completed: false,
        sessionId: "session-0",
        submitted: true,
        terminalFailure: false,
        visible: true,
      },
      {
        cleanedUp: false,
        completed: false,
        sessionId: "session-1",
        submitted: true,
        terminalFailure: false,
        visible: true,
      },
      {
        cleanedUp: false,
        completed: false,
        sessionId: "session-2",
        submitted: true,
        terminalFailure: false,
        visible: true,
      },
    ]);
    expect(requests.some((request) => request.method === "DELETE")).toBe(false);
  });

  test("delegates terminal session cleanup to injected cleanupSession", () => {
    const requests: BulkRequest[] = [];
    const cleanupCalls: string[] = [];
    const sessionStatuses = new Map<string, Array<"Pending" | "Succeeded">>([
      ["session-0", ["Pending", "Succeeded"]],
    ]);
    const client = mockBulkClient(requests, sessionStatuses);
    let nowMs = 0;

    const result = runBulkSkahaStressSurface(bulkStressConfig(1), client, undefined, {
      cleanupSession: (sessionId) => {
        cleanupCalls.push(sessionId);
        return true;
      },
      now: () => nowMs,
      sleep: (seconds) => {
        nowMs += seconds * 1000;
      },
    });

    expect(result.succeeded).toBe(true);
    expect(cleanupCalls).toEqual(["session-0"]);
    expect(requests.filter((request) => request.method === "DELETE")).toEqual([]);
  });
});

interface BulkRequest {
  method: "DELETE" | "GET" | "POST";
  sessionId: string;
}

function bulkStressConfig(sessionCount: number): SkahaBulkStressConfig {
  return {
    completionTimeoutSeconds: 120,
    pollCycleSeconds: 0,
    pollMinSeconds: 0,
    session: (index) => baseSession(`perfpulse-batch-${index}`),
    sessionCount,
  };
}

function baseSession(name: string): SkahaCreateSessionParams {
  return {
    args: ["--cpu", "1", "--timeout", "10s", "--metrics-brief"],
    cmd: "stress-ng",
    image: "images.canfar.net/skaha/stress-ng:latest",
    name,
  };
}

function lifecycleRecorder(events: Array<[string, number | string | undefined]>): {
  recordCompleted(completionLatencyMs: number): void;
  recordFailure(stage: string): void;
  recordSubmitted(submissionDurationMs: number): void;
  recordVisible(visibilityLatencyMs: number): void;
} {
  return {
    recordCompleted(completionLatencyMs) {
      events.push(["completed", completionLatencyMs]);
    },
    recordFailure(stage) {
      events.push(["failure", stage]);
    },
    recordSubmitted(submissionDurationMs) {
      events.push(["submitted", submissionDurationMs]);
    },
    recordVisible(visibilityLatencyMs) {
      events.push(["visible", visibilityLatencyMs]);
    },
  };
}

function mockBulkClient(
  requests: BulkRequest[],
  sessionStatuses: Map<string, Array<"Error" | "Failed" | "Pending" | "Running" | "Succeeded">>,
): SkahaSurfaceClient {
  let createIndex = 0;
  return {
    createSession() {
      const sessionId = `session-${createIndex}`;
      createIndex += 1;
      requests.push({ method: "POST", sessionId });
      return { accepted: true, sessionId, statusCode: 200 };
    },
    deleteSession(sessionId) {
      requests.push({ method: "DELETE", sessionId });
      return { cleanupSucceeded: true, deleted: true, statusCode: 202 };
    },
    getSession(sessionId) {
      requests.push({ method: "GET", sessionId });
      const statuses = sessionStatuses.get(sessionId) ?? ["Succeeded"];
      const status = statuses.shift() ?? "Succeeded";
      return {
        found: true,
        session: { id: sessionId, status },
        status,
        statusCode: 200,
      };
    },
  };
}
