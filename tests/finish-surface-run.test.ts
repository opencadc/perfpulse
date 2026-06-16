import { describe, expect, test } from "bun:test";
import { shouldCleanupAfterFailure } from "../src/cleanup-policy";
import { resolveRunConfig } from "../src/config";
import { runtimeHarness } from "./helpers/k6-runtime-harness";

const {
  executeBulkSkahaStressRun,
  executeSurfaceRun,
  finishSurfaceRun,
  kubernetesJobCreateChecks,
  skahaSessionCreateChecks,
} = await import("../src/finish-surface-run");

describe("shouldCleanupAfterFailure", () => {
  test("skips cleanup when preserve on failure is enabled for a failed run", () => {
    const config = resolveRunConfig({
      PRESERVE_ON_FAILURE: "true",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
    });

    expect(shouldCleanupAfterFailure(config, "visibility")).toBe(false);
  });

  test("still cleans up failed runs when preserve on failure is disabled", () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
    });

    expect(shouldCleanupAfterFailure(config, "visibility")).toBe(true);
  });

  test("never cleans up after submission failures", () => {
    const config = resolveRunConfig({
      PRESERVE_ON_FAILURE: "false",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
    });

    expect(shouldCleanupAfterFailure(config, "submission")).toBe(false);
  });
});

describe("finishSurfaceRun", () => {
  test("fails when create checks do not pass even without a lifecycle failure", () => {
    runtimeHarness.checkCalls.length = 0;
    const config = resolveRunConfig({ PERF_PULSE_CLIENT_MODE: "kubernetes" });
    let cleanupCalled = false;

    expect(() =>
      finishSurfaceRun(
        config,
        { cleanupKubernetesJob: () => undefined } as never,
        { createResponse: { status: 500 } },
        {
          "kubernetes job create returned 201": (response) =>
            (response as { status: number }).status === 201,
        },
        () => {
          cleanupCalled = true;
        },
      ),
    ).toThrow("work create response checks failed");

    expect(runtimeHarness.checkCalls).toEqual([
      {
        checks: { "kubernetes job create returned 201": false },
        subject: { status: 500 },
      },
    ]);
    expect(cleanupCalled).toBe(false);
  });

  test("prefers lifecycle failure messages when both checks and lifecycle fail", () => {
    runtimeHarness.checkCalls.length = 0;
    const config = resolveRunConfig({ PERF_PULSE_CLIENT_MODE: "kubernetes" });

    expect(() =>
      finishSurfaceRun(
        config,
        { cleanupKubernetesJob: () => undefined } as never,
        {
          createResponse: { status: 500 },
          failure: { message: "Kubernetes Job create failed with HTTP 500", stage: "submission" },
        },
        {
          "kubernetes job create returned 201": (response) =>
            (response as { status: number }).status === 201,
        },
        () => undefined,
      ),
    ).toThrow("Kubernetes Job create failed with HTTP 500");

    expect(runtimeHarness.checkCalls).toEqual([]);
  });
});

describe("executeSurfaceRun", () => {
  test("runs execute, passes result to finish flow, and cleans up on success when config.cleanup=true", () => {
    runtimeHarness.checkCalls.length = 0;
    const config = resolveRunConfig({
      CLEANUP: "true",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
    });
    const createResponse = { status: 201 };
    let executeCalled = false;
    let cleanupAdapter: unknown;
    let cleanupResult: unknown;

    executeSurfaceRun(config, { cleanupKubernetesJob: () => undefined } as never, {
      execute: () => {
        executeCalled = true;
        return { createResponse };
      },
      createChecks: kubernetesJobCreateChecks("kubernetes job create returned 201"),
      cleanupWith: (adapter, result) => {
        cleanupAdapter = adapter;
        cleanupResult = result;
      },
    });

    expect(executeCalled).toBe(true);
    expect(runtimeHarness.checkCalls).toEqual([
      {
        checks: { "kubernetes job create returned 201": true },
        subject: createResponse,
      },
    ]);
    expect(cleanupAdapter).toBeDefined();
    expect(cleanupResult).toEqual({ createResponse });
  });
});

describe("executeBulkSkahaStressRun", () => {
  test("fails the iteration when the bulk batch reports a lifecycle failure", () => {
    const config = resolveRunConfig({
      CLEANUP: "true",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
    });

    expect(() =>
      executeBulkSkahaStressRun(config, { cleanupSkahaSession: () => undefined } as never, {
        execute: () => ({
          createResponse: { accepted: true },
          failure: {
            message: "Skaha bulk stress batch did not complete within 120s",
            stage: "completion",
          },
          sessions: [
            {
              cleanedUp: false,
              completed: false,
              sessionId: "session-0",
              submitted: true,
              terminalFailure: false,
              visible: true,
            },
          ],
        }),
      }),
    ).toThrow("Skaha bulk stress batch did not complete within 120s");
  });

  test("cleans up uncleaned sessions after a completion failure when cleanup is enabled", () => {
    const config = resolveRunConfig({
      CLEANUP: "true",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
    });
    const cleaned: string[] = [];

    expect(() =>
      executeBulkSkahaStressRun(
        config,
        {
          cleanupSkahaSession: (sessionId: string | undefined) => {
            cleaned.push(String(sessionId));
          },
        } as never,
        {
          execute: () => ({
            createResponse: { accepted: true },
            failure: { message: "batch timed out", stage: "completion" },
            sessions: [
              {
                cleanedUp: true,
                completed: true,
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
            ],
          }),
        },
      ),
    ).toThrow("batch timed out");

    expect(cleaned).toEqual(["session-1"]);
  });
});

describe("surface create check helpers", () => {
  test("kubernetesJobCreateChecks validates HTTP 201 responses", () => {
    const checks = kubernetesJobCreateChecks("job create returned 201");
    const validate = checks["job create returned 201"];
    if (validate === undefined) {
      throw new Error("expected job create check");
    }

    expect(validate({ status: 201 })).toBe(true);
    expect(validate({ status: 500 })).toBe(false);
  });

  test("skahaSessionCreateChecks validates 2xx status codes", () => {
    const checks = skahaSessionCreateChecks();
    const validate = checks["skaha session create returned 2xx"];
    if (validate === undefined) {
      throw new Error("expected skaha session create check");
    }

    expect(validate({ statusCode: 200 })).toBe(true);
    expect(validate({ statusCode: 299 })).toBe(true);
    expect(validate({ statusCode: 404 })).toBe(false);
  });
});
