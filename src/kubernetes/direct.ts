import type { RunConfig } from "../config";
import type { LifecycleRecorder } from "../metrics";
import {
  isCoreWorkLifecycleFailureStage,
  type LifecycleGroupFn,
  runWorkLifecycle,
} from "../work-lifecycle";
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
  group?: LifecycleGroupFn,
): DirectKubernetesRunResult {
  let latestJobList: JobListLike = {};

  const lifecycle = runWorkLifecycle(
    {
      completionTimeoutSeconds: config.completionTimeoutSeconds,
      pollIntervalSeconds: config.kubernetes.pollIntervalSeconds,
      pollJitterMaxMs: config.pollJitterMaxMs,
      requireCompletion: config.requireCompletion,
      visibilityGateSeconds: config.visibilityGateSeconds,
    },
    {
      pollVisibility() {
        latestJobList = client.listJobsByTestId();
        return findJobByName(latestJobList, config.jobName) !== undefined;
      },
      readTerminalState() {
        const job = currentJob(client, latestJobList, config.jobName);
        return terminalState(job);
      },
      submit() {
        const createResponse = client.createJob(buildDirectJobManifest(config));
        if (createResponse.status !== 201) {
          return {
            accepted: false,
            failureMessage: `Kubernetes Job create failed with HTTP ${createResponse.status}: ${String(
              createResponse.body,
            )}`,
            response: createResponse,
          };
        }
        return { accepted: true, response: createResponse };
      },
    },
    pollUntil,
    {
      recordCompleted(completionLatencyMs) {
        recorder?.recordCompleted(completionLatencyMs);
      },
      recordFailure(stage) {
        if (isCoreWorkLifecycleFailureStage(stage)) {
          recorder?.recordFailure(stage);
        }
      },
      recordSubmitted(submissionDurationMs) {
        recorder?.recordSubmitted(submissionDurationMs);
      },
      recordVisible(visibilityLatencyMs) {
        recorder?.recordVisible(visibilityLatencyMs);
      },
    },
    now,
    group,
  );

  const failure =
    lifecycle.failure !== undefined && isCoreWorkLifecycleFailureStage(lifecycle.failure.stage)
      ? mapDirectFailure(config, {
          message: lifecycle.failure.message,
          stage: lifecycle.failure.stage,
        })
      : undefined;

  return {
    completed: lifecycle.completed,
    ...(lifecycle.completionLatencyMs === undefined
      ? {}
      : { completionLatencyMs: lifecycle.completionLatencyMs }),
    createResponse: lifecycle.submitResponse,
    ...(failure === undefined ? {} : { failure }),
    submissionDurationMs: lifecycle.submissionDurationMs,
    visible: lifecycle.visible,
    ...(lifecycle.visibilityLatencyMs === undefined
      ? {}
      : { visibilityLatencyMs: lifecycle.visibilityLatencyMs }),
  };
}

function currentJob(
  client: DirectKubernetesClient,
  cachedList: JobListLike,
  jobName: string,
): JobLike | undefined {
  return findJobByName(cachedList, jobName) ?? findJobByName(client.listJobsByTestId(), jobName);
}

function terminalState(job: JobLike | undefined): "failed" | "succeeded" | undefined {
  if (job === undefined) {
    return undefined;
  }
  if (isJobComplete(job)) {
    return "succeeded";
  }
  if (isJobFailed(job)) {
    return "failed";
  }
  return undefined;
}

function mapDirectFailure(
  config: RunConfig,
  failure: { message: string; stage: DirectKubernetesFailureStage },
): DirectKubernetesRunFailure {
  switch (failure.stage) {
    case "submission":
      return failure;
    case "visibility":
      return {
        message: `Kubernetes Job ${config.jobName} was not visible within ${config.visibilityGateSeconds}s`,
        stage: failure.stage,
      };
    case "completion":
      if (failure.message === "work reached a failed terminal state") {
        return {
          message: `Kubernetes Job ${config.jobName} reached Failed`,
          stage: failure.stage,
        };
      }
      return {
        message: `Kubernetes Job ${config.jobName} did not complete within ${config.completionTimeoutSeconds}s`,
        stage: failure.stage,
      };
  }
}
