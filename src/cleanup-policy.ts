import type { RunConfig } from "./config";

export function shouldCleanupAfterFailure(
  config: Pick<RunConfig, "cleanup" | "preserveOnFailure">,
  failureStage: string,
): boolean {
  return config.cleanup && failureStage !== "submission" && !config.preserveOnFailure;
}
