import type { RunConfig } from "../config";
import type { LifecycleRecorder } from "../metrics";
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
): KueueSurfaceResult {
  const manifest = buildKueueJobManifest(config, options);
  const createStartedAt = now();
  const createResponse = client.createJob(manifest);
  const submittedAt = now();
  const submissionDurationMs = submittedAt - createStartedAt;

  if (createResponse.status !== 201) {
    recorder?.recordFailure("submission");
    return {
      admitted: false,
      createResponse,
      failure: {
        category: "kubernetes-api",
        message: `Kueue Job create failed with HTTP ${createResponse.status}`,
        stage: "submission",
      },
      jobVisible: false,
      submissionDurationMs,
      workloadVisible: false,
      completed: false,
    };
  }

  recorder?.recordSubmitted(submissionDurationMs);

  const jobVisibleList = pollUntil(
    config.visibilityGateSeconds,
    config.kubernetes.pollIntervalSeconds,
    () => client.listJobsByTestId(),
    (list) => findJobByName(list, config.jobName) !== undefined,
    config.pollJitterMaxMs,
  );
  if (jobVisibleList === undefined) {
    recorder?.recordFailure("visibility");
    return {
      admitted: false,
      createResponse,
      failure: {
        category: "visibility",
        message: `Kueue Job was not visible within ${config.visibilityGateSeconds}s`,
        stage: "job-visibility",
      },
      jobVisible: false,
      submissionDurationMs,
      workloadVisible: false,
      completed: false,
    };
  }

  const visibilityLatencyMs = now() - submittedAt;
  recorder?.recordVisible(visibilityLatencyMs);
  const workloadVisibleList = pollUntil(
    config.visibilityGateSeconds,
    config.kubernetes.pollIntervalSeconds,
    () => client.listWorkloadsByTestId(),
    (list) => findWorkloadForJob(list, config.jobName) !== undefined,
    config.pollJitterMaxMs,
  );
  if (workloadVisibleList === undefined) {
    recorder?.recordFailure("visibility");
    return {
      admitted: false,
      createResponse,
      failure: {
        category: "visibility",
        message: `Kueue Workload was not visible within ${config.visibilityGateSeconds}s`,
        stage: "workload-visibility",
      },
      jobVisible: true,
      submissionDurationMs,
      visibilityLatencyMs,
      workloadVisible: false,
      completed: false,
    };
  }

  const workloadVisibilityLatencyMs = now() - submittedAt;
  let admissionLatencyMs: number | undefined;
  const terminalState = pollUntil(
    config.completionTimeoutSeconds,
    config.kubernetes.pollIntervalSeconds,
    () => ({
      jobs: client.listJobsByTestId(),
      workloads: client.listWorkloadsByTestId(),
    }),
    (state) => {
      if (
        admissionLatencyMs === undefined &&
        isWorkloadAdmitted(findWorkloadForJob(state.workloads, config.jobName))
      ) {
        admissionLatencyMs = now() - submittedAt;
        recorder?.recordAdmission(admissionLatencyMs);
      }
      return isTerminalJob(findJobByName(state.jobs, config.jobName));
    },
    config.pollJitterMaxMs,
  );
  const terminalJob = findJobByName(terminalState?.jobs ?? {}, config.jobName);
  const admitted =
    admissionLatencyMs !== undefined ||
    isWorkloadAdmitted(findWorkloadForJob(terminalState?.workloads ?? {}, config.jobName));

  if (terminalJob === undefined) {
    recorder?.recordFailure("completion");
    return {
      admitted,
      ...(admissionLatencyMs !== undefined ? { admissionLatencyMs } : {}),
      completed: false,
      createResponse,
      failure: {
        category: "completion",
        message: `Kueue Job ${config.jobName} did not complete within ${config.completionTimeoutSeconds}s`,
        stage: "completion",
      },
      jobVisible: true,
      submissionDurationMs,
      visibilityLatencyMs,
      workloadVisible: true,
      workloadVisibilityLatencyMs,
    };
  }

  if (isJobFailed(terminalJob)) {
    recorder?.recordFailure("completion");
    return {
      admitted,
      ...(admissionLatencyMs !== undefined ? { admissionLatencyMs } : {}),
      completed: false,
      createResponse,
      failure: {
        category: "completion",
        message: `Kueue Job ${config.jobName} reached Failed`,
        stage: "completion",
      },
      jobVisible: true,
      submissionDurationMs,
      visibilityLatencyMs,
      workloadVisible: true,
      workloadVisibilityLatencyMs,
    };
  }

  const completionLatencyMs = now() - submittedAt;
  recorder?.recordCompleted(completionLatencyMs);

  return {
    admitted,
    ...(admissionLatencyMs !== undefined ? { admissionLatencyMs } : {}),
    completed: true,
    completionLatencyMs,
    createResponse,
    jobVisible: true,
    submissionDurationMs,
    visibilityLatencyMs,
    workloadVisible: true,
    workloadVisibilityLatencyMs,
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

function isTerminalJob(job: JobLike | undefined): boolean {
  return job !== undefined && (isJobComplete(job) || isJobFailed(job));
}
