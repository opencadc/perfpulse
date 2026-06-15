import type { RunConfig } from "../config";
import type { LifecycleRecorder } from "../metrics";
import { buildDirectJobManifest, type KubernetesJobManifest } from "./job";
import {
  findJobByName,
  isJobComplete,
  isJobFailed,
  type JobLike,
  type JobListLike,
} from "./status";

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
  jitterMaxMs?: number,
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

type DirectLifecycleRecorder = Pick<
  LifecycleRecorder,
  "recordCompleted" | "recordFailure" | "recordSubmitted" | "recordVisible"
>;

export function runDirectKubernetesSurface(
  config: RunConfig,
  client: DirectKubernetesClient,
  pollUntil: PollUntil,
  now: () => number = Date.now,
  recorder?: DirectLifecycleRecorder,
): DirectKubernetesRunResult {
  const manifest = buildDirectJobManifest(config);
  const createStartedAt = now();
  const createResponse = client.createJob(manifest);
  const submittedAt = now();
  const submissionDurationMs = submittedAt - createStartedAt;

  if (createResponse.status !== 201) {
    recorder?.recordFailure("submission");
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

  recorder?.recordSubmitted(submissionDurationMs);

  const visibleList = pollUntil(
    config.visibilityGateSeconds,
    config.kubernetes.pollIntervalSeconds,
    () => client.listJobsByTestId(),
    (list) => findJobByName(list, config.jobName) !== undefined,
    config.pollJitterMaxMs,
  );
  if (visibleList === undefined) {
    recorder?.recordFailure("visibility");
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
  recorder?.recordVisible(visibilityLatencyMs);
  const visibleJob = findJobByName(visibleList, config.jobName);
  const terminalJob = isTerminalJob(visibleJob)
    ? visibleJob
    : findJobByName(
        pollUntil(
          config.completionTimeoutSeconds,
          config.kubernetes.pollIntervalSeconds,
          () => client.listJobsByTestId(),
          (list) => isTerminalJob(findJobByName(list, config.jobName)),
          config.pollJitterMaxMs,
        ) ?? {},
        config.jobName,
      );

  if (terminalJob === undefined) {
    recorder?.recordFailure("completion");
    return {
      completed: false,
      createResponse,
      failure: {
        message: `Kubernetes Job ${config.jobName} did not complete within ${config.completionTimeoutSeconds}s`,
        stage: "completion",
      },
      submissionDurationMs,
      visible: true,
      visibilityLatencyMs,
    };
  }

  if (isJobFailed(terminalJob)) {
    recorder?.recordFailure("completion");
    return {
      completed: false,
      createResponse,
      failure: {
        message: `Kubernetes Job ${config.jobName} reached Failed`,
        stage: "completion",
      },
      submissionDurationMs,
      visible: true,
      visibilityLatencyMs,
    };
  }

  recorder?.recordCompleted(now() - submittedAt);

  return {
    completed: true,
    completionLatencyMs: now() - submittedAt,
    createResponse,
    submissionDurationMs,
    visible: true,
    visibilityLatencyMs,
  };
}

function isTerminalJob(job: JobLike | undefined): boolean {
  return job !== undefined && (isJobComplete(job) || isJobFailed(job));
}
