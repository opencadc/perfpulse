import type { RunConfig } from "../config";
import { buildKueueJobManifest, type KubernetesJobManifest, type KueueJobOptions } from "./job";
import { findJobByName, type JobListLike } from "./status";

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
) => T | undefined;

export interface KueueSurfaceOptions extends KueueJobOptions {
  admissionGateSeconds: number;
}

export type KueueFailureStage =
  | "submission"
  | "job-visibility"
  | "workload-visibility"
  | "admission";

export type KueueFailureCategory = "kubernetes-api" | "visibility" | "kueue-admission";

export interface KueueSurfaceFailure {
  category: KueueFailureCategory;
  message: string;
  stage: KueueFailureStage;
}

export interface KueueSurfaceResult {
  admitted: boolean;
  admissionLatencyMs?: number;
  createResponse: KueueResponseLike;
  failure?: KueueSurfaceFailure;
  jobVisible: boolean;
  submissionDurationMs: number;
  visibilityLatencyMs?: number;
  workloadVisible: boolean;
  workloadVisibilityLatencyMs?: number;
}

export function runKueueKubernetesSurface(
  config: RunConfig,
  options: KueueSurfaceOptions,
  client: KueueKubernetesClient,
  pollUntil: PollUntil,
  now: () => number = Date.now,
): KueueSurfaceResult {
  const manifest = buildKueueJobManifest(config, options);
  const submittedAt = now();
  const createResponse = client.createJob(manifest);
  const submissionDurationMs = now() - submittedAt;

  if (createResponse.status !== 201) {
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
    };
  }

  const jobVisibleList = pollUntil(
    config.visibilityGateSeconds,
    config.kubernetes.pollIntervalSeconds,
    () => client.listJobsByTestId(),
    (list) => findJobByName(list, config.jobName) !== undefined,
  );
  if (jobVisibleList === undefined) {
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
    };
  }

  const visibilityLatencyMs = now() - submittedAt;
  const workloadVisibleList = pollUntil(
    config.visibilityGateSeconds,
    config.kubernetes.pollIntervalSeconds,
    () => client.listWorkloadsByTestId(),
    (list) => findWorkloadForJob(list, config.jobName) !== undefined,
  );
  if (workloadVisibleList === undefined) {
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
    };
  }

  const workloadVisibilityLatencyMs = now() - submittedAt;
  const admittedList = pollUntil(
    options.admissionGateSeconds,
    config.kubernetes.pollIntervalSeconds,
    () => client.listWorkloadsByTestId(),
    (list) => isWorkloadAdmitted(findWorkloadForJob(list, config.jobName)),
  );
  const admittedWorkload =
    admittedList === undefined ? undefined : findWorkloadForJob(admittedList, config.jobName);

  if (!isWorkloadAdmitted(admittedWorkload)) {
    return {
      admitted: false,
      createResponse,
      failure: {
        category: "kueue-admission",
        message: `Kueue Workload was visible but not admitted within ${options.admissionGateSeconds}s`,
        stage: "admission",
      },
      jobVisible: true,
      submissionDurationMs,
      visibilityLatencyMs,
      workloadVisible: true,
      workloadVisibilityLatencyMs,
    };
  }

  return {
    admitted: true,
    admissionLatencyMs: now() - submittedAt,
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
