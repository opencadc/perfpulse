import { describe, expect, test } from "bun:test";
import { resolveRunConfig } from "../src/config";
import { createLifecycleRecorder } from "../src/lifecycle-recorder";
import { METRIC_NAMES, metricTags } from "../src/metrics-contract";
import { createLifecycleMetricSpies } from "./helpers/lifecycle-metric-spies";

describe("LifecycleRecorder", () => {
  test("records lifecycle stage metrics with contract names and tags", () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      SURFACE: "k8s-kueue",
      TESTID: "kueue-spot",
    });
    const { callsByName, metrics } = createLifecycleMetricSpies();
    const recorder = createLifecycleRecorder(config, metrics);
    const tags = metricTags(config);

    recorder.recordExpected(3);
    recorder.recordSubmitted(10);
    recorder.recordVisible(20);
    recorder.recordAdmission(30);
    recorder.recordCompleted(40);
    recorder.recordCleanup(2);

    expect(callsByName[METRIC_NAMES.jobsExpected]).toEqual([{ tags, value: 3 }]);
    expect(callsByName[METRIC_NAMES.jobsSubmitted]).toEqual([{ tags, value: 1 }]);
    expect(callsByName[METRIC_NAMES.submissionDurationMs]).toEqual([{ tags, value: 10 }]);
    expect(callsByName[METRIC_NAMES.jobsVisible]).toEqual([{ tags, value: 1 }]);
    expect(callsByName[METRIC_NAMES.visibilityLatencyMs]).toEqual([{ tags, value: 20 }]);
    expect(callsByName[METRIC_NAMES.kueueWorkloadsAdmitted]).toEqual([{ tags, value: 1 }]);
    expect(callsByName[METRIC_NAMES.kueueAdmissionLatencyMs]).toEqual([{ tags, value: 30 }]);
    expect(callsByName[METRIC_NAMES.jobsCompleted]).toEqual([{ tags, value: 1 }]);
    expect(callsByName[METRIC_NAMES.completionLatencyMs]).toEqual([{ tags, value: 40 }]);
    expect(callsByName[METRIC_NAMES.cleanupDeleted]).toEqual([{ tags, value: 2 }]);
  });

  test("maps failure stages to the matching failure counters", () => {
    const config = resolveRunConfig({ TESTID: "failure-spot" });
    const { callsByName, metrics } = createLifecycleMetricSpies();
    const recorder = createLifecycleRecorder(config, metrics);
    const tags = metricTags(config);

    recorder.recordFailure("submission");
    recorder.recordFailure("visibility");
    recorder.recordFailure("admission");
    recorder.recordFailure("completion");
    recorder.recordFailure("cleanup");

    expect(callsByName[METRIC_NAMES.jobsSubmissionFailed]).toEqual([{ tags, value: 1 }]);
    expect(callsByName[METRIC_NAMES.jobsVisibilityFailed]).toEqual([{ tags, value: 1 }]);
    expect(callsByName[METRIC_NAMES.kueueWorkloadsAdmissionFailed]).toEqual([{ tags, value: 1 }]);
    expect(callsByName[METRIC_NAMES.jobsCompletionFailed]).toEqual([{ tags, value: 1 }]);
    expect(callsByName[METRIC_NAMES.cleanupFailed]).toEqual([{ tags, value: 1 }]);
  });
});
