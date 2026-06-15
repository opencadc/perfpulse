import { check, fail } from "k6";
import type { CleanupAdapter } from "./cleanup";
import type { RunConfig } from "./config";

export interface SurfaceRunFailure {
  message: string;
  stage: string;
}

export interface SurfaceRunResult {
  createResponse: unknown;
  failure?: SurfaceRunFailure;
}

export function finishSurfaceRun(
  config: RunConfig,
  cleanup: CleanupAdapter,
  result: SurfaceRunResult,
  createChecks: Record<string, (response: { status: number }) => boolean> | undefined,
  cleanupWork: (adapter: CleanupAdapter) => void,
): void {
  if (createChecks !== undefined) {
    check(result.createResponse as { status: number }, createChecks);
  }

  if (result.failure !== undefined) {
    if (config.cleanup && result.failure.stage !== "submission") {
      cleanupWork(cleanup);
    }
    fail(result.failure.message);
  }

  if (config.cleanup) {
    cleanupWork(cleanup);
  }
}
