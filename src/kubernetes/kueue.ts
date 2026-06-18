import type { RunConfig } from "../config";
import type { LifecycleRecorder } from "../metrics";
import { type LifecycleGroupFn, runWorkLifecycle } from "../work-lifecycle";
import { buildKueueJobManifest, type KubernetesJobManifest, type KueueJobOptions } from "./job";
import {
  findJobByName,
  isJobComplete,
  isJobFailed,
  type JobLike,
  type JobListLike,
} from "./status";

export interface KueueResponseLike {
  body?: unknown;
  status: number;
}

export interface WorkloadConditionLike {
  status?: string;
  type?: string;
}

export interface WorkloadLike {
  metadata?: {
    ownerReferences?: Array<{
      kind?: string;
      name?: string;
    }>;
  };
  status?: {
    conditions?: WorkloadConditionLike[];
  };
}

export interface WorkloadListLike {
  items?: WorkloadLike[];
}

export interface KueueKubernetesClient {
  createJob(manifest: KubernetesJobManifest): KueueResponseLike;
  listJobsByTestId(): JobListLike;
  listWorkloadsByTestId(): WorkloadListLike;
}

export type PollUntil = <T>(
  timeoutSeconds: number,
  intervalSeconds: number,
  read: () => T,
  done: (value: T) => boolean,
  jitterMaxMs?: number,
) => T | undefined;

export interface KueueSurfaceOptions extends KueueJobOptions {
  admissionGateSeconds: number;
}

export type KueueFailureStage =
  | "submission"
  | "job-visibility"
  | "workload-visibility"
  | "admission"
  | "completion";

export type KueueFailureCategory =
  | "kubernetes-api"
  | "visibility"
  | "kueue-admission"
  | "completion";

export interface KueueSurfaceFailure {
  category: KueueFailureCategory;
  message: string;
  stage: KueueFailureStage;
}

export interface KueueSurfaceResult {
  admitted: boolean;
  admissionLatencyMs?: number;
  completed: boolean;
  completionLatencyMs?: number;
  createResponse: KueueResponseLike;
  failure?: KueueSurfaceFailure;
  jobVisible: boolean;
  submissionDurationMs: number;
  visibilityLatencyMs?: number;
  workloadVisible: boolean;
  workloadVisibilityLatencyMs?: number;
}

type KueueLifecycleRecorder = Pick<
  LifecycleRecorder,
  "recordAdmission" | "recordCompleted" | "recordFailure" | "recordSubmitted" | "recordVisible"
>;

export function runKueueKubernetesSurface(
  config: RunConfig,
  options: KueueSurfaceOptions,
  client: KueueKubernetesClient,
  pollUntil: PollUntil,
  now: () => number = Date.now,
  recorder?: KueueLifecycleRecorder,
  group?: LifecycleGroupFn,
): KueueSurfaceResult {
  let latestJobList: JobListLike = {};
  let latestWorkloadList: WorkloadListLike = {};

  const lifecycle = runWorkLifecycle(
    {
      admissionGateSeconds: options.admissionGateSeconds,
      completionTimeoutSeconds: config.completionTimeoutSeconds,
      enforceAdmission: config.runClass === "cron",
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
      pollWorkloadVisibility() {
        latestWorkloadList = client.listWorkloadsByTestId();
        return findWorkloadForJob(latestWorkloadList, config.jobName) !== undefined;
      },
      readAdmitted() {
        latestWorkloadList = client.listWorkloadsByTestId();
        const workload = findWorkloadForJob(latestWorkloadList, config.jobName);
        return isWorkloadAdmitted(workload);
      },
      readTerminalState() {
        latestJobList = client.listJobsByTestId();
        const job =
          findJobByName(latestJobList, config.jobName) ??
          findJobByName(client.listJobsByTestId(), config.jobName);
        return readJobTerminalState(job);
      },
      submit() {
        const createResponse = client.createJob(buildKueueJobManifest(config, options));
        if (createResponse.status !== 201) {
          return {
            accepted: false,
            failureMessage: `Kueue Job create failed with HTTP ${createResponse.status}`,
            response: createResponse,
          };
        }
        return { accepted: true, response: createResponse };
      },
    },
    pollUntil,
    {
      recordAdmission(admissionLatencyMs) {
        recorder?.recordAdmission(admissionLatencyMs);
      },
      recordCompleted(completionLatencyMs) {
        recorder?.recordCompleted(completionLatencyMs);
      },
      recordFailure(stage) {
        recorder?.recordFailure(mapRecorderFailureStage(stage));
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

  return mapKueueSurfaceResult(config, lifecycle);
}

function mapRecorderFailureStage(
  stage: "submission" | "visibility" | "workload-visibility" | "admission" | "completion",
): "admission" | "completion" | "submission" | "visibility" {
  if (stage === "workload-visibility") {
    return "visibility";
  }
  return stage;
}

function mapKueueSurfaceResult(
  config: RunConfig,
  lifecycle: ReturnType<typeof runWorkLifecycle<KueueResponseLike>>,
): KueueSurfaceResult {
  const base = {
    admitted: lifecycle.admitted ?? false,
    ...(lifecycle.admissionLatencyMs !== undefined
      ? { admissionLatencyMs: lifecycle.admissionLatencyMs }
      : {}),
    completed: lifecycle.completed,
    ...(lifecycle.completionLatencyMs !== undefined
      ? { completionLatencyMs: lifecycle.completionLatencyMs }
      : {}),
    createResponse: lifecycle.submitResponse,
    jobVisible: lifecycle.visible,
    submissionDurationMs: lifecycle.submissionDurationMs,
    ...(lifecycle.visibilityLatencyMs !== undefined
      ? { visibilityLatencyMs: lifecycle.visibilityLatencyMs }
      : {}),
    workloadVisible: lifecycle.workloadVisible ?? false,
    ...(lifecycle.workloadVisibilityLatencyMs !== undefined
      ? { workloadVisibilityLatencyMs: lifecycle.workloadVisibilityLatencyMs }
      : {}),
  };

  if (lifecycle.failure === undefined) {
    return base;
  }

  return {
    ...base,
    failure: mapKueueFailure(config, lifecycle.failure),
  };
}

function mapKueueFailure(
  config: RunConfig,
  failure: { message: string; stage: string },
): KueueSurfaceFailure {
  switch (failure.stage) {
    case "submission":
      return {
        category: "kubernetes-api",
        message: failure.message,
        stage: "submission",
      };
    case "visibility":
      return {
        category: "visibility",
        message: `Kueue Job ${config.jobName} was not visible within ${config.visibilityGateSeconds}s`,
        stage: "job-visibility",
      };
    case "workload-visibility":
      return {
        category: "visibility",
        message: `Kueue Workload was not visible within ${config.visibilityGateSeconds}s`,
        stage: "workload-visibility",
      };
    case "admission":
      return {
        category: "kueue-admission",
        message: `Kueue Workload for Job ${config.jobName} was not admitted within ${config.kueue.admissionGateSeconds}s`,
        stage: "admission",
      };
    case "completion":
      if (failure.message === "work reached a failed terminal state") {
        return {
          category: "completion",
          message: `Kueue Job ${config.jobName} reached Failed`,
          stage: "completion",
        };
      }
      return {
        category: "completion",
        message: `Kueue Job ${config.jobName} did not complete within ${config.completionTimeoutSeconds}s`,
        stage: "completion",
      };
  }
  return {
    category: "completion",
    message: failure.message,
    stage: "completion",
  };
}

export function findWorkloadForJob(
  list: WorkloadListLike,
  jobName: string,
): WorkloadLike | undefined {
  return list.items?.find((workload) =>
    workload.metadata?.ownerReferences?.some(
      (ownerReference) => ownerReference.kind === "Job" && ownerReference.name === jobName,
    ),
  );
}

export function isWorkloadAdmitted(workload: WorkloadLike | undefined): boolean {
  return (
    workload?.status?.conditions?.some(
      (condition) => condition.type === "Admitted" && condition.status === "True",
    ) ?? false
  );
}

function readJobTerminalState(job: JobLike | undefined): "failed" | "succeeded" | undefined {
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
