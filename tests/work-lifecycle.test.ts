import { beforeEach, describe, expect, test } from "bun:test";
import type { PollUntil } from "../src/kubernetes/direct";
import {
  type LifecycleGroupFn,
  runWorkLifecycle,
  type WorkLifecycleCallbacks,
  type WorkLifecyclePorts,
} from "../src/work-lifecycle";

const lifecycleGroupCalls: string[] = [];

const trackingGroup: LifecycleGroupFn = (name, fn) => {
  lifecycleGroupCalls.push(name);
  return fn();
};

describe("runWorkLifecycle", () => {
  beforeEach(() => {
    lifecycleGroupCalls.length = 0;
  });

  test("segments lifecycle stages with k6 groups for dashboard drilldown", () => {
    const callbacks = createCallbacks([]);
    const ports = createPorts({
      terminalAfterVisibility: false,
      terminalAfterCompletionPoll: "succeeded",
    });
    const pollUntil = createPassThroughPoller();

    runWorkLifecycle(
      {
        completionTimeoutSeconds: 30,
        pollIntervalSeconds: 1,
        pollJitterMaxMs: 0,
        requireCompletion: true,
        visibilityGateSeconds: 10,
      },
      ports,
      pollUntil,
      callbacks,
      advancingClock([0, 100, 250, 600]),
      trackingGroup,
    );

    expect(lifecycleGroupCalls).toEqual([
      "work_lifecycle",
      "work_submit",
      "work_visible",
      "work_complete",
    ]);
  });

  test("waits for terminal completion when require completion is on", () => {
    const events: string[] = [];
    const callbacks = createCallbacks(events);
    const ports = createPorts({
      terminalAfterVisibility: false,
      terminalAfterCompletionPoll: "succeeded",
    });
    const pollUntil = createPassThroughPoller();
    const timestamps = [0, 100, 250, 600];

    const result = runWorkLifecycle(
      {
        completionTimeoutSeconds: 30,
        pollIntervalSeconds: 1,
        pollJitterMaxMs: 0,
        requireCompletion: true,
        visibilityGateSeconds: 10,
      },
      ports,
      pollUntil,
      callbacks,
      () => timestamps.shift() ?? 600,
    );

    expect(result.failure).toBeUndefined();
    expect(result.visible).toBe(true);
    expect(result.completed).toBe(true);
    expect(events).toEqual(["submitted", "visible", "completed"]);
    expect(ports.completionPolls).toBe(1);
  });

  test("succeeds after visibility without completion polling when require completion is off", () => {
    const events: string[] = [];
    const callbacks = createCallbacks(events);
    const ports = createPorts({ terminalAfterVisibility: false });
    const pollUntil = createPassThroughPoller();

    const result = runWorkLifecycle(
      {
        completionTimeoutSeconds: 30,
        pollIntervalSeconds: 1,
        pollJitterMaxMs: 0,
        requireCompletion: false,
        visibilityGateSeconds: 10,
      },
      ports,
      pollUntil,
      callbacks,
      advancingClock([0, 100, 250]),
      trackingGroup,
    );

    expect(result.failure).toBeUndefined();
    expect(result.visible).toBe(true);
    expect(result.completed).toBe(false);
    expect(events).toEqual(["submitted", "visible"]);
    expect(ports.completionPolls).toBe(0);
    expect(lifecycleGroupCalls).not.toContain("work_complete");
  });

  test("records opportunistic completion when already terminal during the visibility pass", () => {
    const events: string[] = [];
    const callbacks = createCallbacks(events);
    const ports = createPorts({ terminalAfterVisibility: "succeeded" });
    const pollUntil = createPassThroughPoller();

    const result = runWorkLifecycle(
      {
        completionTimeoutSeconds: 30,
        pollIntervalSeconds: 1,
        pollJitterMaxMs: 0,
        requireCompletion: false,
        visibilityGateSeconds: 10,
      },
      ports,
      pollUntil,
      callbacks,
      advancingClock([0, 100, 400, 400]),
    );

    expect(result.failure).toBeUndefined();
    expect(result.visible).toBe(true);
    expect(result.completed).toBe(true);
    expect(result.completionLatencyMs).toBe(300);
    expect(events).toEqual(["submitted", "visible", "completed"]);
    expect(ports.completionPolls).toBe(0);
  });

  test("records submission failure when submit is not accepted", () => {
    const events: string[] = [];
    const callbacks = createCallbacks(events);
    const ports: WorkLifecyclePorts<{ id: string }> = {
      pollVisibility() {
        return false;
      },
      readTerminalState() {
        return undefined;
      },
      submit() {
        return {
          accepted: false,
          failureMessage: "Kubernetes Job create failed with HTTP 500",
          response: { id: "work-1" },
        };
      },
    };

    const result = runWorkLifecycle(
      {
        completionTimeoutSeconds: 30,
        pollIntervalSeconds: 1,
        pollJitterMaxMs: 0,
        requireCompletion: true,
        visibilityGateSeconds: 10,
      },
      ports,
      createPassThroughPoller(),
      callbacks,
    );

    expect(result.visible).toBe(false);
    expect(result.completed).toBe(false);
    expect(result.failure).toEqual({
      message: "Kubernetes Job create failed with HTTP 500",
      stage: "submission",
    });
    expect(events).toEqual(["failure:submission"]);
  });

  test("records visibility failure when work never becomes visible", () => {
    const events: string[] = [];
    const callbacks = createCallbacks(events);
    const ports: WorkLifecyclePorts<{ id: string }> = {
      pollVisibility() {
        return false;
      },
      readTerminalState() {
        return undefined;
      },
      submit() {
        return { accepted: true, response: { id: "work-1" } };
      },
    };

    const result = runWorkLifecycle(
      {
        completionTimeoutSeconds: 30,
        pollIntervalSeconds: 1,
        pollJitterMaxMs: 0,
        requireCompletion: true,
        visibilityGateSeconds: 10,
      },
      ports,
      createNeverCompletingPoller(),
      callbacks,
    );

    expect(result.visible).toBe(false);
    expect(result.failure).toEqual({
      message: "work was not visible within the visibility gate",
      stage: "visibility",
    });
    expect(events).toEqual(["submitted", "failure:visibility"]);
  });

  test("records completion failure when work never reaches a terminal state", () => {
    const events: string[] = [];
    const callbacks = createCallbacks(events);
    const ports = createPorts({ terminalAfterVisibility: false });

    const result = runWorkLifecycle(
      {
        completionTimeoutSeconds: 30,
        pollIntervalSeconds: 1,
        pollJitterMaxMs: 0,
        requireCompletion: true,
        visibilityGateSeconds: 10,
      },
      ports,
      createPassThroughPoller(),
      callbacks,
    );

    expect(result.visible).toBe(true);
    expect(result.completed).toBe(false);
    expect(result.failure).toEqual({
      message: "work did not complete within the completion timeout",
      stage: "completion",
    });
    expect(events).toEqual(["submitted", "visible", "failure:completion"]);
  });

  test("enforces admission after workload visibility when configured", () => {
    const events: string[] = [];
    const callbacks = createCallbacks(events);
    const admitted = false;
    const ports: WorkLifecyclePorts<{ id: string }> = {
      pollVisibility() {
        return true;
      },
      pollWorkloadVisibility() {
        return true;
      },
      readAdmitted() {
        return admitted;
      },
      readTerminalState() {
        return undefined;
      },
      submit() {
        return { accepted: true, response: { id: "work-1" } };
      },
    };

    let pollCount = 0;
    const poller: PollUntil = (_timeout, _interval, read, done) => {
      pollCount += 1;
      const value = read();
      if (pollCount <= 2) {
        return done(value) ? value : undefined;
      }
      return undefined;
    };

    const result = runWorkLifecycle(
      {
        admissionGateSeconds: 5,
        completionTimeoutSeconds: 30,
        enforceAdmission: true,
        pollIntervalSeconds: 1,
        pollJitterMaxMs: 0,
        requireCompletion: true,
        visibilityGateSeconds: 10,
      },
      ports,
      poller,
      callbacks,
      advancingClock([0, 100, 250, 400]),
    );

    expect(result.visible).toBe(true);
    expect(result.workloadVisible).toBe(true);
    expect(result.admitted).toBe(false);
    expect(result.completed).toBe(false);
    expect(result.failure).toEqual({
      message: "work was not admitted within the admission gate",
      stage: "admission",
    });
    expect(events).toEqual(["submitted", "visible", "failure:admission"]);
  });

  test("records completion failure when work reaches a failed terminal state", () => {
    const events: string[] = [];
    const callbacks = createCallbacks(events);
    const ports = createPorts({ terminalAfterVisibility: "failed" });

    const result = runWorkLifecycle(
      {
        completionTimeoutSeconds: 30,
        pollIntervalSeconds: 1,
        pollJitterMaxMs: 0,
        requireCompletion: true,
        visibilityGateSeconds: 10,
      },
      ports,
      createPassThroughPoller(),
      callbacks,
    );

    expect(result.visible).toBe(true);
    expect(result.completed).toBe(false);
    expect(result.failure).toEqual({
      message: "work reached a failed terminal state",
      stage: "completion",
    });
    expect(events).toEqual(["submitted", "visible", "failure:completion"]);
  });
});

function createNeverCompletingPoller(): PollUntil {
  return () => undefined;
}

function advancingClock(values: number[]): () => number {
  return () => values.shift() ?? values.at(-1) ?? 0;
}

function createCallbacks(events: string[]): WorkLifecycleCallbacks {
  return {
    recordCompleted() {
      events.push("completed");
    },
    recordFailure(stage) {
      events.push(`failure:${stage}`);
    },
    recordSubmitted() {
      events.push("submitted");
    },
    recordVisible() {
      events.push("visible");
    },
  };
}

function createPorts(options: {
  terminalAfterVisibility: false | "succeeded" | "failed";
  terminalAfterCompletionPoll?: "succeeded" | "failed";
}) {
  let visible = false;
  let terminalReads = 0;
  let completionPolls = 0;
  const ports: WorkLifecyclePorts<{ id: string }> & { completionPolls: number } = {
    completionPolls: 0,
    submit() {
      return { accepted: true, response: { id: "work-1" } };
    },
    pollVisibility() {
      visible = true;
      return true;
    },
    readTerminalState() {
      if (!visible) {
        return undefined;
      }
      if (options.terminalAfterVisibility !== false) {
        return options.terminalAfterVisibility;
      }
      terminalReads += 1;
      if (terminalReads === 1) {
        return undefined;
      }
      completionPolls += 1;
      ports.completionPolls = completionPolls;
      return options.terminalAfterCompletionPoll;
    },
  };
  return ports;
}

function createPassThroughPoller(): PollUntil {
  return (_timeout, _interval, read, done) => {
    const value = read();
    return done(value) ? value : value;
  };
}
