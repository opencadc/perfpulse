import { check, fail } from "k6";
import type { CleanupAdapter } from "./cleanup";
import { shouldCleanupAfterFailure } from "./cleanup-policy";
import type { RunConfig } from "./config";
import type { SkahaBulkStressSessionResult } from "./skaha";

export interface SurfaceRunFailure {
  message: string;
  stage: string;
}

export interface SurfaceRunResult {
  createResponse: unknown;
  failure?: SurfaceRunFailure;
}

export interface SurfaceRunBinding {
  execute(): SurfaceRunResult;
  createChecks?: Record<string, (response: unknown) => boolean>;
  cleanupWith(adapter: CleanupAdapter, result: SurfaceRunResult): void;
}

export function kubernetesJobCreateChecks(
  checkLabel: string,
): Record<string, (response: unknown) => boolean> {
  return {
    [checkLabel]: (response) => (response as { status: number }).status === 201,
  };
}

export function skahaSessionCreateChecks(): Record<string, (response: unknown) => boolean> {
  return {
    "skaha session create returned 2xx": (response) => {
      const statusCode = (response as { statusCode: number }).statusCode;
      return statusCode >= 200 && statusCode < 300;
    },
  };
}

export function executeSurfaceRun(
  config: RunConfig,
  cleanup: CleanupAdapter,
  binding: SurfaceRunBinding,
): void {
  const result = binding.execute();
  finishSurfaceRun(config, cleanup, result, binding.createChecks, (adapter) =>
    binding.cleanupWith(adapter, result),
  );
}

export interface BulkSkahaStressRunResult extends SurfaceRunResult {
  sessions: SkahaBulkStressSessionResult[];
}

export function executeBulkSkahaStressRun(
  config: RunConfig,
  cleanup: CleanupAdapter,
  binding: { execute(): BulkSkahaStressRunResult },
): void {
  const result = binding.execute();
  if (result.failure !== undefined) {
    if (shouldCleanupAfterFailure(config, result.failure.stage)) {
      for (const session of result.sessions) {
        if (session.sessionId !== undefined && !session.cleanedUp) {
          cleanup.cleanupSkahaSession(session.sessionId);
        }
      }
    }
    fail(result.failure.message);
  }
}

export function finishSurfaceRun(
  config: RunConfig,
  cleanup: CleanupAdapter,
  result: SurfaceRunResult,
  createChecks: Record<string, (response: unknown) => boolean> | undefined,
  cleanupWork: (adapter: CleanupAdapter) => void,
): void {
  if (result.failure !== undefined) {
    if (shouldCleanupAfterFailure(config, result.failure.stage)) {
      cleanupWork(cleanup);
    }
    fail(result.failure.message);
  }

  if (createChecks !== undefined) {
    const createPassed = check(result.createResponse, createChecks);
    if (!createPassed) {
      fail("work create response checks failed");
    }
  }

  if (config.cleanup) {
    cleanupWork(cleanup);
  }
}
