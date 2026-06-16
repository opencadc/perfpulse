import type { PollUntil } from "./kubernetes/direct";

export type LifecycleGroupFn = <T>(name: string, fn: () => T) => T;

const passthroughGroup: LifecycleGroupFn = (_name, fn) => fn();

export type CoreWorkLifecycleFailureStage = "submission" | "visibility" | "completion";

export type WorkLifecycleFailureStage =
  | CoreWorkLifecycleFailureStage
  | "workload-visibility"
  | "admission";

export function isCoreWorkLifecycleFailureStage(
  stage: WorkLifecycleFailureStage,
): stage is CoreWorkLifecycleFailureStage {
  return stage === "submission" || stage === "visibility" || stage === "completion";
}

export type TerminalState = "failed" | "succeeded" | undefined;

export interface WorkLifecyclePolicy {
  admissionGateSeconds?: number;
  completionTimeoutSeconds: number;
  enforceAdmission?: boolean;
  pollIntervalSeconds: number;
  pollJitterMaxMs: number;
  requireCompletion: boolean;
  visibilityGateSeconds: number;
}

export interface WorkLifecyclePorts<TSubmitResponse> {
  pollVisibility(): boolean;
  pollWorkloadVisibility?(): boolean;
  readAdmitted?(): boolean;
  readTerminalState(): TerminalState;
  submit(): {
    accepted: boolean;
    failureMessage?: string;
    response: TSubmitResponse;
  };
}

export interface WorkLifecycleCallbacks {
  recordAdmission?(admissionLatencyMs: number): void;
  recordCompleted(completionLatencyMs: number): void;
  recordFailure(stage: WorkLifecycleFailureStage): void;
  recordSubmitted(submissionDurationMs: number): void;
  recordVisible(visibilityLatencyMs: number): void;
}

export interface WorkLifecycleFailure {
  message: string;
  stage: WorkLifecycleFailureStage;
}

export interface WorkLifecycleResult<TSubmitResponse> {
  admitted?: boolean;
  admissionLatencyMs?: number;
  completed: boolean;
  completionLatencyMs?: number;
  failure?: WorkLifecycleFailure;
  submissionDurationMs: number;
  submitResponse: TSubmitResponse;
  visible: boolean;
  visibilityLatencyMs?: number;
  workloadVisible?: boolean;
  workloadVisibilityLatencyMs?: number;
}

export function runWorkLifecycle<TSubmitResponse>(
  policy: WorkLifecyclePolicy,
  ports: WorkLifecyclePorts<TSubmitResponse>,
  pollUntil: PollUntil,
  callbacks: WorkLifecycleCallbacks,
  now: () => number = Date.now,
  group: LifecycleGroupFn = passthroughGroup,
): WorkLifecycleResult<TSubmitResponse> {
  return group("work_lifecycle", () => {
    const submitStartedAt = now();
    const submitResult = group("work_submit", () => ports.submit());
    const submittedAt = now();
    const submissionDurationMs = submittedAt - submitStartedAt;

    if (!submitResult.accepted) {
      callbacks.recordFailure("submission");
      return {
        completed: false,
        failure: {
          message: submitResult.failureMessage ?? "work submission was not accepted",
          stage: "submission",
        },
        submissionDurationMs,
        submitResponse: submitResult.response,
        visible: false,
      };
    }

    callbacks.recordSubmitted(submissionDurationMs);

    const visible = group("work_visible", () =>
      pollUntil(
        policy.visibilityGateSeconds,
        policy.pollIntervalSeconds,
        () => ports.pollVisibility(),
        (isVisible) => isVisible,
        policy.pollJitterMaxMs,
      ),
    );
    if (visible !== true) {
      callbacks.recordFailure("visibility");
      return {
        completed: false,
        failure: {
          message: "work was not visible within the visibility gate",
          stage: "visibility",
        },
        submissionDurationMs,
        submitResponse: submitResult.response,
        visible: false,
      };
    }

    const measuredVisibilityLatencyMs = now() - submittedAt;
    callbacks.recordVisible(measuredVisibilityLatencyMs);

    let workloadVisible = ports.pollWorkloadVisibility === undefined;
    let workloadVisibilityLatencyMs: number | undefined;
    let admissionLatencyMs: number | undefined;
    let admitted = ports.readAdmitted?.() ?? false;

    const recordDiagnosticAdmission = (): void => {
      if (admissionLatencyMs !== undefined || ports.readAdmitted === undefined) {
        return;
      }
      if (!ports.readAdmitted()) {
        return;
      }
      admissionLatencyMs = now() - submittedAt;
      admitted = true;
      callbacks.recordAdmission?.(admissionLatencyMs);
    };

    const skipOpportunisticSucceeded = policy.requireCompletion && ports.readAdmitted !== undefined;

    const completeOnSucceeded = (): WorkLifecycleResult<TSubmitResponse> | undefined => {
      const terminalState = ports.readTerminalState();
      if (terminalState === "succeeded" && !skipOpportunisticSucceeded) {
        const completionLatencyMs = now() - submittedAt;
        callbacks.recordCompleted(completionLatencyMs);
        return buildResult({
          completed: true,
          completionLatencyMs,
          measuredVisibilityLatencyMs,
          submissionDurationMs,
          submitResponse: submitResult.response,
          ...lifecycleStateFields({
            admitted,
            admissionLatencyMs,
            workloadVisibilityLatencyMs,
            workloadVisible,
          }),
        });
      }
      if (terminalState === "failed" && policy.requireCompletion) {
        callbacks.recordFailure("completion");
        return buildResult({
          completed: false,
          failure: {
            message: "work reached a failed terminal state",
            stage: "completion",
          },
          measuredVisibilityLatencyMs,
          submissionDurationMs,
          submitResponse: submitResult.response,
          ...lifecycleStateFields({
            admitted,
            admissionLatencyMs,
            workloadVisibilityLatencyMs,
            workloadVisible,
          }),
        });
      }
      return undefined;
    };

    if (ports.pollWorkloadVisibility === undefined) {
      const opportunistic = completeOnSucceeded();
      if (opportunistic !== undefined) {
        return opportunistic;
      }
    }

    if (ports.pollWorkloadVisibility !== undefined) {
      const pollWorkloadVisibility = ports.pollWorkloadVisibility;
      const workloadVisibleResult = group("work_workload_visible", () =>
        pollUntil(
          policy.visibilityGateSeconds,
          policy.pollIntervalSeconds,
          () => pollWorkloadVisibility(),
          (isVisible) => isVisible,
          policy.pollJitterMaxMs,
        ),
      );
      if (workloadVisibleResult !== true) {
        callbacks.recordFailure("visibility");
        return buildResult({
          admitted: false,
          completed: false,
          failure: {
            message: "workload was not visible within the visibility gate",
            stage: "workload-visibility",
          },
          measuredVisibilityLatencyMs,
          submissionDurationMs,
          submitResponse: submitResult.response,
          workloadVisible: false,
        });
      }
      workloadVisible = true;
      workloadVisibilityLatencyMs = now() - submittedAt;

      const opportunistic = completeOnSucceeded();
      if (opportunistic !== undefined) {
        return opportunistic;
      }
    }

    if (policy.enforceAdmission) {
      const admittedResult = group("work_admission", () =>
        pollUntil(
          policy.admissionGateSeconds ?? 0,
          policy.pollIntervalSeconds,
          () => ports.readAdmitted?.() ?? false,
          (value) => value === true,
          policy.pollJitterMaxMs,
        ),
      );
      if (admittedResult !== true) {
        callbacks.recordFailure("admission");
        return buildResult({
          admitted: false,
          completed: false,
          failure: {
            message: "work was not admitted within the admission gate",
            stage: "admission",
          },
          measuredVisibilityLatencyMs,
          submissionDurationMs,
          submitResponse: submitResult.response,
          ...lifecycleStateFields({ workloadVisibilityLatencyMs, workloadVisible }),
        });
      }
      admissionLatencyMs = now() - submittedAt;
      admitted = true;
      callbacks.recordAdmission?.(admissionLatencyMs);
    }

    if (!policy.requireCompletion) {
      recordDiagnosticAdmission();
      return buildResult({
        completed: false,
        measuredVisibilityLatencyMs,
        submissionDurationMs,
        submitResponse: submitResult.response,
        ...lifecycleStateFields({
          admitted,
          admissionLatencyMs,
          workloadVisibilityLatencyMs,
          workloadVisible,
        }),
      });
    }

    const terminalAfterPoll = group("work_complete", () =>
      pollUntil(
        policy.completionTimeoutSeconds,
        policy.pollIntervalSeconds,
        () => {
          if (!policy.enforceAdmission) {
            recordDiagnosticAdmission();
          }
          return ports.readTerminalState();
        },
        (state) => state === "succeeded" || state === "failed",
        policy.pollJitterMaxMs,
      ),
    );

    if (terminalAfterPoll === undefined) {
      callbacks.recordFailure("completion");
      return buildResult({
        completed: false,
        failure: {
          message: "work did not complete within the completion timeout",
          stage: "completion",
        },
        measuredVisibilityLatencyMs,
        submissionDurationMs,
        submitResponse: submitResult.response,
        ...lifecycleStateFields({
          admitted,
          admissionLatencyMs,
          workloadVisibilityLatencyMs,
          workloadVisible,
        }),
      });
    }

    if (terminalAfterPoll === "failed") {
      callbacks.recordFailure("completion");
      return buildResult({
        completed: false,
        failure: {
          message: "work reached a failed terminal state",
          stage: "completion",
        },
        measuredVisibilityLatencyMs,
        submissionDurationMs,
        submitResponse: submitResult.response,
        ...lifecycleStateFields({
          admitted,
          admissionLatencyMs,
          workloadVisibilityLatencyMs,
          workloadVisible,
        }),
      });
    }

    const completionLatencyMs = now() - submittedAt;
    callbacks.recordCompleted(completionLatencyMs);

    return buildResult({
      completed: true,
      completionLatencyMs,
      measuredVisibilityLatencyMs,
      submissionDurationMs,
      submitResponse: submitResult.response,
      ...lifecycleStateFields({
        admitted,
        admissionLatencyMs,
        workloadVisibilityLatencyMs,
        workloadVisible,
      }),
    });
  });
}

function lifecycleStateFields(state: {
  admitted?: boolean | undefined;
  admissionLatencyMs?: number | undefined;
  workloadVisibilityLatencyMs?: number | undefined;
  workloadVisible?: boolean | undefined;
}): Pick<
  WorkLifecycleResult<unknown>,
  "admitted" | "admissionLatencyMs" | "workloadVisibilityLatencyMs" | "workloadVisible"
> {
  return {
    ...(state.admitted !== undefined ? { admitted: state.admitted } : {}),
    ...(state.admissionLatencyMs !== undefined
      ? { admissionLatencyMs: state.admissionLatencyMs }
      : {}),
    ...(state.workloadVisibilityLatencyMs !== undefined
      ? { workloadVisibilityLatencyMs: state.workloadVisibilityLatencyMs }
      : {}),
    ...(state.workloadVisible !== undefined ? { workloadVisible: state.workloadVisible } : {}),
  };
}

function buildResult<TSubmitResponse>(params: {
  completed: boolean;
  measuredVisibilityLatencyMs: number;
  submissionDurationMs: number;
  submitResponse: TSubmitResponse;
  admitted?: boolean;
  admissionLatencyMs?: number;
  completionLatencyMs?: number;
  failure?: WorkLifecycleFailure;
  workloadVisibilityLatencyMs?: number;
  workloadVisible?: boolean;
}): WorkLifecycleResult<TSubmitResponse> {
  const {
    admitted,
    admissionLatencyMs,
    completed,
    completionLatencyMs,
    failure,
    measuredVisibilityLatencyMs,
    submissionDurationMs,
    submitResponse,
    workloadVisibilityLatencyMs,
    workloadVisible,
  } = params;

  return {
    ...(admitted !== undefined ? { admitted } : {}),
    ...(admissionLatencyMs !== undefined ? { admissionLatencyMs } : {}),
    completed,
    ...(completionLatencyMs !== undefined ? { completionLatencyMs } : {}),
    ...(failure !== undefined ? { failure } : {}),
    submissionDurationMs,
    submitResponse,
    visible: true,
    visibilityLatencyMs: measuredVisibilityLatencyMs,
    ...(workloadVisible !== undefined ? { workloadVisible } : {}),
    ...(workloadVisibilityLatencyMs !== undefined ? { workloadVisibilityLatencyMs } : {}),
  };
}
