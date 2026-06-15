import { check, fail } from "k6";
import type { RunConfig } from "./config";
import { KUBERNETES_LABEL_KEYS } from "./labels";
import type { JobLike, JobListLike } from "./kubernetes/status";
import type { LifecycleRecorder } from "./metrics";

export interface KubernetesJobDeleter {
  deleteJob(name: string): { status: number };
}

export interface KubernetesJobLister extends KubernetesJobDeleter {
  listJobsByTestId(): JobListLike;
}

export interface SkahaSessionDeleter {
  deleteSession(sessionId: string): {
    cleanupSucceeded: boolean;
    deleted: boolean;
    statusCode: number;
  };
  getSession(sessionId: string): { found: boolean; statusCode: number };
}

export interface CleanupAdapter {
  cleanupKubernetesJob(jobName: string | undefined): void;
  cleanupKubernetesJobsBulk(): void;
  cleanupSkahaSession(sessionId: string | undefined): void;
}

export interface CleanupClients {
  kubernetes?: KubernetesJobLister;
  skaha?: SkahaSessionDeleter;
}

export function createCleanupAdapter(
  config: RunConfig,
  recorder: LifecycleRecorder,
  clients: CleanupClients,
): CleanupAdapter {
  return {
    cleanupKubernetesJob(jobName) {
      cleanupKubernetesJobInline(config, recorder, clients.kubernetes, jobName);
    },
    cleanupKubernetesJobsBulk() {
      cleanupKubernetesJobsBulk(config, recorder, clients.kubernetes);
    },
    cleanupSkahaSession(sessionId) {
      cleanupSkahaSessionInline(config, recorder, clients.skaha, sessionId);
    },
  };
}

export function isKubernetesDeleteAccepted(status: number): boolean {
  return status === 200 || status === 202 || status === 404;
}

function cleanupKubernetesJobInline(
  config: RunConfig,
  recorder: LifecycleRecorder,
  client: KubernetesJobDeleter | undefined,
  jobName: string | undefined,
): void {
  if (!config.cleanup) {
    recorder.recordCleanup(0);
    return;
  }
  if (jobName === undefined) {
    recorder.recordFailure("cleanup");
    fail("Kubernetes cleanup failed without a Job name");
    return;
  }
  if (client === undefined) {
    recorder.recordFailure("cleanup");
    fail("Kubernetes cleanup client is required");
    return;
  }

  const response = client.deleteJob(jobName);
  const cleanupOk = isKubernetesDeleteAccepted(response.status);
  check(response, {
    "cleanup delete accepted or already gone": () => cleanupOk,
  });

  if (response.status === 200 || response.status === 202) {
    recorder.recordCleanup(1);
  }
  if (!cleanupOk) {
    recorder.recordFailure("cleanup");
    fail(`Cleanup failed for Kubernetes Job ${jobName} with HTTP ${response.status}`);
  }
}

function cleanupSkahaSessionInline(
  config: RunConfig,
  recorder: LifecycleRecorder,
  client: SkahaSessionDeleter | undefined,
  sessionId: string | undefined,
): void {
  if (!config.cleanup) {
    recorder.recordCleanup(0);
    return;
  }
  if (sessionId === undefined) {
    recorder.recordFailure("cleanup");
    return;
  }
  if (client === undefined) {
    recorder.recordFailure("cleanup");
    fail("Skaha cleanup client is required");
    return;
  }

  const result = client.deleteSession(sessionId);
  const cleanupSucceeded =
    result.cleanupSucceeded || isSkahaSessionVerifiedGone(client.getSession(sessionId));
  check(result, {
    "skaha cleanup delete accepted or already gone": () => cleanupSucceeded,
  });

  if (result.deleted) {
    recorder.recordCleanup(1);
  }
  if (!cleanupSucceeded) {
    recorder.recordFailure("cleanup");
    fail(`Skaha cleanup failed with HTTP ${result.statusCode}`);
  }
}

function cleanupKubernetesJobsBulk(
  config: RunConfig,
  recorder: LifecycleRecorder,
  client: KubernetesJobLister | undefined,
): void {
  if (client === undefined) {
    recorder.recordFailure("cleanup");
    fail("Kubernetes cleanup client is required");
    return;
  }

  let jobs: JobListLike;
  try {
    jobs = client.listJobsByTestId();
  } catch (error) {
    recorder.recordCleanup(0);
    recorder.recordFailure("cleanup");
    fail(
      `Cleanup failed while listing Kubernetes Jobs for testid ${config.testid} surface ${config.surface}: ${boundedMessage(error)}`,
    );
    return;
  }

  const failures: string[] = [];
  let deletedCount = 0;

  for (const job of (jobs.items ?? []).filter((job) => isCurrentSurfaceJob(job, config))) {
    const jobName = job.metadata?.name;
    if (jobName === undefined) {
      continue;
    }

    const response = client.deleteJob(jobName);
    const cleanupOk = isKubernetesDeleteAccepted(response.status);
    check(response, {
      "cleanup delete accepted or already gone": () => cleanupOk,
    });

    if (response.status === 200 || response.status === 202) {
      deletedCount += 1;
    }
    if (!cleanupOk) {
      failures.push(`${jobName} HTTP ${response.status}`);
    }
  }

  recorder.recordCleanup(deletedCount);
  if (failures.length > 0) {
    recorder.recordFailure("cleanup");
    fail(`Cleanup failed for ${failures.length} Kubernetes Job(s): ${failures.join(", ")}`);
  }
}

function isSkahaSessionVerifiedGone(result: { found: boolean; statusCode: number }): boolean {
  return !result.found && result.statusCode === 404;
}

function isCurrentSurfaceJob(job: JobLike, config: RunConfig): boolean {
  return job.metadata?.labels?.[KUBERNETES_LABEL_KEYS.surface] === config.surface;
}

function boundedMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 300);
}
