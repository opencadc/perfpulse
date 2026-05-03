import { describe, expect, test } from "bun:test";
import { makeJobName, resolveRunConfig, sanitizeDnsLabel, sanitizeLabelValue } from "../src/config";

describe("resolveRunConfig", () => {
  test("defaults to local no-op mode for M0", () => {
    const config = resolveRunConfig({});

    expect(config.clientMode).toBe("noop");
    expect(config.profile).toBe("spot-direct-tiny");
    expect(config.surface).toBe("k8s-direct");
    expect(config.testid).toBe("local-noop");
    expect(config.jobName).toBe("perfpulse-local-noop-0");
  });

  test("resolves the M0.5 kind Kubernetes path", () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      TESTID: "Kind Smoke 01",
      WORKLOAD_NAMESPACE: "canfar-workloads",
    });

    expect(config.clientMode).toBe("kubernetes");
    expect(config.testid).toBe("kind-smoke-01");
    expect(config.kubernetes.namespace).toBe("canfar-workloads");
    expect(config.jobName).toBe("perfpulse-kind-smoke-01-0");
    expect(config.workload.durationSeconds).toBe(10);
    expect(config.workload.image).toBe("docker.io/alexeiled/stress-ng");
    expect(config.workload.command).toBeUndefined();
    expect(config.workload.args).toEqual(["--cpu", "1", "--timeout", "10s", "--metrics-brief"]);
  });

  test("rejects unsupported surfaces until later milestones implement them", () => {
    expect(() => resolveRunConfig({ SURFACE: "k8s-kueue" })).toThrow(
      'SURFACE must be "k8s-direct"',
    );
  });

  test("rejects malformed workload commands", () => {
    expect(() => resolveRunConfig({ WORKLOAD_COMMAND: '{"cmd":"sleep"}' })).toThrow(
      "WORKLOAD_COMMAND must be a JSON array of strings",
    );
    expect(() => resolveRunConfig({ WORKLOAD_COMMAND: "[]" })).toThrow(
      "WORKLOAD_COMMAND must be a non-empty JSON array of strings",
    );
  });

  test("accepts explicit workload command arrays", () => {
    const config = resolveRunConfig({
      WORKLOAD_COMMAND: '["sh","-c","echo ok"]',
    });

    expect(config.workload.command).toEqual(["sh", "-c", "echo ok"]);
  });

  test("accepts explicit workload args arrays", () => {
    const config = resolveRunConfig({
      WORKLOAD_ARGS: '["--cpu","2","--timeout","5s"]',
    });

    expect(config.workload.args).toEqual(["--cpu", "2", "--timeout", "5s"]);
  });
});

describe("Kubernetes-safe names", () => {
  test("sanitizes DNS labels and label values", () => {
    expect(sanitizeDnsLabel("PerfPulse_Run.01", "fallback")).toBe("perfpulse-run-01");
    expect(sanitizeLabelValue("PerfPulse_Run.01", "fallback")).toBe("perfpulse_run.01");
  });

  test("keeps truncated label values valid", () => {
    const value = `${"a".repeat(62)}-suffix`;

    expect(sanitizeLabelValue(value, "fallback")).toBe("a".repeat(62));
  });

  test("keeps generated Job names under the Kubernetes 63 character limit", () => {
    const name = makeJobName("a".repeat(120), 0);

    expect(name.length).toBeLessThanOrEqual(63);
    expect(name).toStartWith("perfpulse-");
    expect(name).toEndWith("-0");
  });
});
