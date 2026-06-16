import { describe, expect, mock, test } from "bun:test";
import { shouldCleanupAfterFailure } from "../src/cleanup-policy";
import { resolveRunConfig } from "../src/config";

const finishHarness = {
  checkCalls: [] as Array<{ checks: Record<string, boolean>; subject: unknown }>,
  failures: [] as string[],
  lastCheckPassed: true,
};

mock.module("k6", () => ({
  check(subject: unknown, checks: Record<string, (value: unknown) => boolean>) {
    const results = Object.fromEntries(
      Object.entries(checks).map(([name, predicate]) => [name, predicate(subject)]),
    );
    finishHarness.checkCalls.push({ checks: results, subject });
    return finishHarness.lastCheckPassed && Object.values(results).every(Boolean);
  },
  fail(message: string) {
    finishHarness.failures.push(message);
    throw new Error(message);
  },
}));

const { executeSurfaceRun, finishSurfaceRun, kubernetesJobCreateChecks, skahaSessionCreateChecks } =
  await import("../src/finish-surface-run");

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
    finishHarness.checkCalls.length = 0;
    finishHarness.failures.length = 0;
    finishHarness.lastCheckPassed = false;
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

    expect(finishHarness.failures).toEqual(["work create response checks failed"]);
    expect(cleanupCalled).toBe(false);
  });

  test("prefers lifecycle failure messages when both checks and lifecycle fail", () => {
    finishHarness.checkCalls.length = 0;
    finishHarness.failures.length = 0;
    finishHarness.lastCheckPassed = false;
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

    expect(finishHarness.failures).toEqual(["Kubernetes Job create failed with HTTP 500"]);
  });
});

describe("executeSurfaceRun", () => {
  test("runs execute, passes result to finish flow, and cleans up on success when config.cleanup=true", () => {
    finishHarness.checkCalls.length = 0;
    finishHarness.failures.length = 0;
    finishHarness.lastCheckPassed = true;
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
    expect(finishHarness.checkCalls).toEqual([
      {
        checks: { "kubernetes job create returned 201": true },
        subject: createResponse,
      },
    ]);
    expect(finishHarness.failures).toEqual([]);
    expect(cleanupAdapter).toBeDefined();
    expect(cleanupResult).toEqual({ createResponse });
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
