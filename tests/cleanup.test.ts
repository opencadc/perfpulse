import { describe, expect, mock, test } from "bun:test";
import { resolveRunConfig } from "../src/config";
import { KUBERNETES_LABEL_KEYS } from "../src/labels";
import { createLifecycleRecorder } from "../src/lifecycle-recorder";
import { METRIC_NAMES, metricTags } from "../src/metrics-contract";
import { createLifecycleMetricSpies } from "./helpers/lifecycle-metric-spies";

mock.module("k6", () => ({
  check: () => true,
  fail: (message: string) => {
    throw new Error(message);
  },
  sleep: () => {},
}));

describe("CleanupAdapter", () => {
  test("emits no cleanup metrics when cleanup is disabled for inline Kubernetes Job delete", async () => {
    const { createCleanupAdapter } = await import("../src/cleanup");
    const config = resolveRunConfig({
      CLEANUP: "false",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      SURFACE: "k8s-direct",
      TESTID: "no-cleanup",
    });
    const { callsByName, metrics } = createLifecycleMetricSpies();
    const recorder = createLifecycleRecorder(config, metrics);
    const deleteCalls: string[] = [];
    const adapter = createCleanupAdapter(config, recorder, {
      kubernetes: {
        deleteJob(name) {
          deleteCalls.push(name);
          return { status: 202 };
        },
        listJobsByTestId() {
          return { items: [] };
        },
      },
    });

    adapter.cleanupKubernetesJob("perfpulse-no-cleanup-direct-0");

    expect(deleteCalls).toHaveLength(0);
    expect(callsByName[METRIC_NAMES.cleanupDeleted]).toEqual([]);
    expect(callsByName[METRIC_NAMES.cleanupFailed]).toEqual([]);
  });

  test("records deleted count and accepts 200/202 for inline Kubernetes Job cleanup", async () => {
    const { createCleanupAdapter } = await import("../src/cleanup");
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      SURFACE: "k8s-direct",
      TESTID: "inline-k8s",
    });
    const { callsByName, metrics } = createLifecycleMetricSpies();
    const recorder = createLifecycleRecorder(config, metrics);
    const deleteStatuses = [202];
    const adapter = createCleanupAdapter(config, recorder, {
      kubernetes: {
        deleteJob() {
          return { status: deleteStatuses.shift() ?? 202 };
        },
        listJobsByTestId() {
          return { items: [] };
        },
      },
    });

    adapter.cleanupKubernetesJob("perfpulse-inline-k8s-direct-0");

    expect(callsByName[METRIC_NAMES.cleanupDeleted]).toEqual([
      { tags: metricTags(config), value: 1 },
    ]);
    expect(callsByName[METRIC_NAMES.cleanupFailed]).toEqual([]);
  });

  test("accepts 404 for inline Kubernetes Job cleanup without incrementing deleted count", async () => {
    const { createCleanupAdapter } = await import("../src/cleanup");
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      SURFACE: "k8s-kueue",
      TESTID: "inline-gone",
    });
    const { callsByName, metrics } = createLifecycleMetricSpies();
    const recorder = createLifecycleRecorder(config, metrics);
    const adapter = createCleanupAdapter(config, recorder, {
      kubernetes: {
        deleteJob() {
          return { status: 404 };
        },
        listJobsByTestId() {
          return { items: [] };
        },
      },
    });

    adapter.cleanupKubernetesJob("perfpulse-inline-gone-kueue-0");

    expect(callsByName[METRIC_NAMES.cleanupDeleted]).toEqual([]);
    expect(callsByName[METRIC_NAMES.cleanupFailed]).toEqual([]);
  });

  test("fails inline Kubernetes Job cleanup on unexpected delete status", async () => {
    const { createCleanupAdapter } = await import("../src/cleanup");
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      SURFACE: "k8s-direct",
      TESTID: "inline-fail",
    });
    const { callsByName, metrics } = createLifecycleMetricSpies();
    const recorder = createLifecycleRecorder(config, metrics);
    const adapter = createCleanupAdapter(config, recorder, {
      kubernetes: {
        deleteJob() {
          return { status: 500 };
        },
        listJobsByTestId() {
          return { items: [] };
        },
      },
    });

    expect(() => adapter.cleanupKubernetesJob("perfpulse-inline-fail-direct-0")).toThrow(
      "Cleanup failed for Kubernetes Job perfpulse-inline-fail-direct-0 with HTTP 500",
    );
    expect(callsByName[METRIC_NAMES.cleanupFailed]).toEqual([
      { tags: metricTags(config), value: 1 },
    ]);
  });

  test("records cleanup failure when inline Kubernetes Job name is missing", async () => {
    const { createCleanupAdapter } = await import("../src/cleanup");
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      SURFACE: "k8s-direct",
      TESTID: "inline-missing-name",
    });
    const { callsByName, metrics } = createLifecycleMetricSpies();
    const recorder = createLifecycleRecorder(config, metrics);
    const adapter = createCleanupAdapter(config, recorder, {
      kubernetes: {
        deleteJob() {
          return { status: 202 };
        },
        listJobsByTestId() {
          return { items: [] };
        },
      },
    });

    expect(() => adapter.cleanupKubernetesJob(undefined)).toThrow(
      "Kubernetes cleanup failed without a Job name",
    );
    expect(callsByName[METRIC_NAMES.cleanupFailed]).toEqual([
      { tags: metricTags(config), value: 1 },
    ]);
  });

  test("records deleted count for inline Skaha session cleanup", async () => {
    const { createCleanupAdapter } = await import("../src/cleanup");
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      SURFACE: "skaha",
      TESTID: "inline-skaha",
    });
    const { callsByName, metrics } = createLifecycleMetricSpies();
    const recorder = createLifecycleRecorder(config, metrics);
    const adapter = createCleanupAdapter(config, recorder, {
      skaha: {
        deleteSession() {
          return { cleanupSucceeded: true, deleted: true, statusCode: 202 };
        },
        getSession() {
          return { found: false, statusCode: 404 };
        },
      },
    });

    adapter.cleanupSkahaSession("session-inline");

    expect(callsByName[METRIC_NAMES.cleanupDeleted]).toEqual([
      { tags: metricTags(config), value: 1 },
    ]);
    expect(callsByName[METRIC_NAMES.cleanupFailed]).toEqual([]);
  });

  test("treats failed Skaha delete as cleaned up when follow-up get returns not found", async () => {
    const { createCleanupAdapter } = await import("../src/cleanup");
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      SURFACE: "skaha",
      TESTID: "skaha-gone",
    });
    const { callsByName, metrics } = createLifecycleMetricSpies();
    const recorder = createLifecycleRecorder(config, metrics);
    const adapter = createCleanupAdapter(config, recorder, {
      skaha: {
        deleteSession() {
          return { cleanupSucceeded: false, deleted: false, statusCode: 0 };
        },
        getSession() {
          return { found: false, statusCode: 404 };
        },
      },
    });

    adapter.cleanupSkahaSession("session-gone");

    expect(callsByName[METRIC_NAMES.cleanupDeleted]).toEqual([]);
    expect(callsByName[METRIC_NAMES.cleanupFailed]).toEqual([]);
  });

  test("fails Skaha cleanup when failed delete verification still finds the session", async () => {
    const { createCleanupAdapter } = await import("../src/cleanup");
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      SURFACE: "skaha",
      TESTID: "skaha-still-there",
    });
    const { callsByName, metrics } = createLifecycleMetricSpies();
    const recorder = createLifecycleRecorder(config, metrics);
    const adapter = createCleanupAdapter(config, recorder, {
      skaha: {
        deleteSession() {
          return { cleanupSucceeded: false, deleted: false, statusCode: 0 };
        },
        getSession() {
          return { found: true, statusCode: 200 };
        },
      },
    });

    expect(() => adapter.cleanupSkahaSession("session-still-there")).toThrow(
      "Skaha cleanup failed with HTTP 0",
    );
    expect(callsByName[METRIC_NAMES.cleanupFailed]).toEqual([
      { tags: metricTags(config), value: 1 },
    ]);
  });

  test("records cleanup failure without throwing when Skaha session id is missing", async () => {
    const { createCleanupAdapter } = await import("../src/cleanup");
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      SURFACE: "skaha",
      TESTID: "skaha-missing-id",
    });
    const { callsByName, metrics } = createLifecycleMetricSpies();
    const recorder = createLifecycleRecorder(config, metrics);
    const adapter = createCleanupAdapter(config, recorder, {
      skaha: {
        deleteSession() {
          return { cleanupSucceeded: true, deleted: true, statusCode: 202 };
        },
        getSession() {
          return { found: false, statusCode: 404 };
        },
      },
    });

    adapter.cleanupSkahaSession(undefined);

    expect(callsByName[METRIC_NAMES.cleanupFailed]).toEqual([
      { tags: metricTags(config), value: 1 },
    ]);
    expect(callsByName[METRIC_NAMES.cleanupDeleted]).toEqual([]);
  });

  test("bulk cleanup deletes only current-surface jobs and records deleted count", async () => {
    const { createCleanupAdapter } = await import("../src/cleanup");
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      SURFACE: "k8s-direct",
      TESTID: "bulk-direct",
    });
    const { callsByName, metrics } = createLifecycleMetricSpies();
    const recorder = createLifecycleRecorder(config, metrics);
    const deleted: string[] = [];
    const adapter = createCleanupAdapter(config, recorder, {
      kubernetes: {
        deleteJob(name) {
          deleted.push(name);
          return { status: 202 };
        },
        listJobsByTestId() {
          return {
            items: [
              {
                metadata: {
                  labels: { [KUBERNETES_LABEL_KEYS.surface]: "k8s-direct" },
                  name: "perfpulse-bulk-direct-direct-0",
                },
              },
              {
                metadata: {
                  labels: { [KUBERNETES_LABEL_KEYS.surface]: "k8s-kueue" },
                  name: "perfpulse-bulk-direct-kueue-0",
                },
              },
              {
                metadata: {
                  labels: { [KUBERNETES_LABEL_KEYS.surface]: "k8s-direct" },
                  name: "perfpulse-bulk-direct-direct-1",
                },
              },
            ],
          };
        },
      },
    });

    adapter.cleanupKubernetesJobsBulk();

    expect(deleted).toEqual(["perfpulse-bulk-direct-direct-0", "perfpulse-bulk-direct-direct-1"]);
    expect(callsByName[METRIC_NAMES.cleanupDeleted]).toEqual([
      { tags: metricTags(config), value: 2 },
    ]);
    expect(callsByName[METRIC_NAMES.cleanupFailed]).toEqual([]);
  });

  test("bulk cleanup fails when any listed job delete returns an unexpected status", async () => {
    const { createCleanupAdapter } = await import("../src/cleanup");
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      SURFACE: "k8s-kueue",
      TESTID: "bulk-fail",
    });
    const { callsByName, metrics } = createLifecycleMetricSpies();
    const recorder = createLifecycleRecorder(config, metrics);
    const adapter = createCleanupAdapter(config, recorder, {
      kubernetes: {
        deleteJob(name) {
          return { status: name.endsWith("-1") ? 500 : 202 };
        },
        listJobsByTestId() {
          return {
            items: [
              {
                metadata: {
                  labels: { [KUBERNETES_LABEL_KEYS.surface]: "k8s-kueue" },
                  name: "perfpulse-bulk-fail-kueue-0",
                },
              },
              {
                metadata: {
                  labels: { [KUBERNETES_LABEL_KEYS.surface]: "k8s-kueue" },
                  name: "perfpulse-bulk-fail-kueue-1",
                },
              },
            ],
          };
        },
      },
    });

    expect(() => adapter.cleanupKubernetesJobsBulk()).toThrow(
      "Cleanup failed for 1 Kubernetes Job(s): perfpulse-bulk-fail-kueue-1 HTTP 500",
    );
    expect(callsByName[METRIC_NAMES.cleanupDeleted]).toEqual([
      { tags: metricTags(config), value: 1 },
    ]);
    expect(callsByName[METRIC_NAMES.cleanupFailed]).toEqual([
      { tags: metricTags(config), value: 1 },
    ]);
  });

  test("bulk cleanup records failure when job listing fails without emitting cleanup_deleted", async () => {
    const { createCleanupAdapter } = await import("../src/cleanup");
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      SURFACE: "k8s-direct",
      TESTID: "bulk-list-fail",
    });
    const { callsByName, metrics } = createLifecycleMetricSpies();
    const recorder = createLifecycleRecorder(config, metrics);
    const adapter = createCleanupAdapter(config, recorder, {
      kubernetes: {
        deleteJob() {
          return { status: 202 };
        },
        listJobsByTestId() {
          throw new Error("Kubernetes list Jobs failed with HTTP 503: list refused");
        },
      },
    });

    expect(() => adapter.cleanupKubernetesJobsBulk()).toThrow(
      "Cleanup failed while listing Kubernetes Jobs for testid bulk-list-fail surface k8s-direct: Kubernetes list Jobs failed with HTTP 503: list refused",
    );
    expect(callsByName[METRIC_NAMES.cleanupDeleted]).toEqual([]);
    expect(callsByName[METRIC_NAMES.cleanupFailed]).toEqual([
      { tags: metricTags(config), value: 1 },
    ]);
  });
});
