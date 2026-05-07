import type { RunConfig } from "../config";
import { buildDirectJobManifest, type KubernetesJobManifest } from "./job";
import { findJobByName, isJobComplete, type JobListLike } from "./status";

export interface KubernetesResponseLike {
  body?: unknown;
  status: number;
}

export interface DirectKubernetesClient {
  createJob(manifest: KubernetesJobManifest): KubernetesResponseLike;
  listJobsByTestId(): JobListLike;
}

export type PollUntil = <T>(
  timeoutSeconds: number,
  intervalSeconds: number,
  read: () => T,
  done: (value: T) => boolean,
) => T | undefined;

export type DirectKubernetesFailureStage = "submission" | "visibility" | "completion";

export interface DirectKubernetesRunFailure {
  message: string;
  stage: DirectKubernetesFailureStage;
}

export interface DirectKubernetesRunResult {
  completed: boolean;
  completionLatencyMs?: number;
  createResponse: KubernetesResponseLike;
  failure?: DirectKubernetesRunFailure;
  submissionDurationMs: number;
  visible: boolean;
  visibilityLatencyMs?: number;
}

export function runDirectKubernetesSurface(
  config: RunConfig,
  client: DirectKubernetesClient,
  pollUntil: PollUntil,
  now: () => number = Date.now,
): DirectKubernetesRunResult {
  const manifest = buildDirectJobManifest(config);
  const createStartedAt = now();
  const createResponse = client.createJob(manifest);
  const submittedAt = now();
  const submissionDurationMs = submittedAt - createStartedAt;

  if (createResponse.status !== 201) {
    return {
      completed: false,
      createResponse,
      failure: {
        message: `Kubernetes Job create failed with HTTP ${createResponse.status}: ${String(
          createResponse.body,
        )}`,
        stage: "submission",
      },
      submissionDurationMs,
      visible: false,
    };
  }

  const visibleList = pollUntil(
    config.visibilityGateSeconds,
    config.kubernetes.pollIntervalSeconds,
    () => client.listJobsByTestId(),
    (list) => findJobByName(list, config.jobName) !== undefined,
  );
  if (visibleList === undefined) {
    return {
      completed: false,
      createResponse,
      failure: {
        message: `Kubernetes Job ${config.jobName} was not visible within ${config.visibilityGateSeconds}s`,
        stage: "visibility",
      },
      submissionDurationMs,
      visible: false,
    };
  }

  const visibilityLatencyMs = now() - submittedAt;
  const visibleJob = findJobByName(visibleList, config.jobName);
  const completed = visibleJob !== undefined && isJobComplete(visibleJob);

  return {
    completed,
    ...(completed ? { completionLatencyMs: visibilityLatencyMs } : {}),
    createResponse,
    submissionDurationMs,
    visible: true,
    visibilityLatencyMs,
  };
}
