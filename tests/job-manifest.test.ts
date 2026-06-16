import { describe, expect, test } from "bun:test";
import { DEFAULT_WORKLOAD_IMAGE, deriveRunConfigForJob, resolveRunConfig } from "../src/config";
import { buildDirectJobManifest, buildKueueJobManifest } from "../src/kubernetes/job";
import { KUBERNETES_LABEL_KEYS } from "../src/labels";

describe("direct Kubernetes Job manifest", () => {
  test("uses the fixed 1 CPU workload footprint", () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      TESTID: "kind-smoke",
    });
    const manifest = buildDirectJobManifest(config);
    const resources = manifest.spec.template.spec.containers[0]?.resources;

    expect(resources?.requests?.cpu).toBe("1");
    expect(resources?.limits?.cpu).toBe("1");
    expect(resources?.requests?.memory).toBe("1Gi");
  });

  test("builds the M0.5 no-Kueue workload manifest", () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      TESTID: "kind-smoke",
    });
    const manifest = buildDirectJobManifest(config);

    expect(manifest.apiVersion).toBe("batch/v1");
    expect(manifest.kind).toBe("Job");
    expect(manifest.metadata.name).toBe("perfpulse-kind-smoke-direct-0");
    expect(manifest.metadata.namespace).toBe("canfar-workloads");
    expect(manifest.metadata.labels[KUBERNETES_LABEL_KEYS.testid]).toBe("kind-smoke");
    expect(manifest.metadata.labels["kueue.x-k8s.io/queue-name"]).toBeUndefined();
    expect(manifest.spec.suspend).toBe(false);
    expect(manifest.spec.backoffLimit).toBe(0);
    expect(manifest.spec.template.spec.restartPolicy).toBe("Never");
    expect(manifest.spec.template.spec.containers[0]?.image).toBe(DEFAULT_WORKLOAD_IMAGE);
    expect(manifest.spec.template.spec.containers[0]?.command).toEqual(["stress-ng"]);
    expect(manifest.spec.template.spec.containers[0]?.args).toEqual([
      "--cpu",
      "1",
      "--temp-path",
      "/tmp",
      "--timeout",
      "60s",
      "--metrics-brief",
    ]);
    expect(manifest.spec.template.spec.securityContext).toEqual(restrictedPodSecurityContext);
    expect(manifest.spec.template.spec.containers[0]?.securityContext).toEqual(
      restrictedContainerSecurityContext,
    );
  });

  test("labels direct Jobs with derived logical user bucket", () => {
    const config = deriveRunConfigForJob(
      resolveRunConfig({
        LOGICAL_USERS: "2",
        PERF_PULSE_CLIENT_MODE: "kubernetes",
        TESTID: "manual-benchmark",
        TOTAL_JOBS: "6",
      }),
      4,
    );

    const manifest = buildDirectJobManifest(config);

    expect(manifest.metadata.name).toBe("perfpulse-manual-benchmark-direct-4");
    expect(manifest.metadata.labels[KUBERNETES_LABEL_KEYS.userBucket]).toBe("bucket-1");
    expect(manifest.spec.template.metadata.labels[KUBERNETES_LABEL_KEYS.userBucket]).toBe(
      "bucket-1",
    );
  });

  test("builds a suspended Kueue workload manifest with queue and CANFAR parity labels", () => {
    const config = resolveRunConfig({
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      SURFACE: "k8s-kueue",
      TESTID: "kueue-spot",
      WORKLOAD_ACTIVE_DEADLINE_SECONDS: "150",
      WORKLOAD_TTL_SECONDS_AFTER_FINISHED: "45",
    });

    const manifest = buildKueueJobManifest(config, {
      priorityClass: "low",
      queueName: "cadc-default",
      userBucketIndex: 3,
    });

    expect(manifest.metadata.labels[KUBERNETES_LABEL_KEYS.testid]).toBe("kueue-spot");
    expect(manifest.metadata.labels["kueue.x-k8s.io/queue-name"]).toBe("cadc-default");
    expect(manifest.metadata.labels["kueue.x-k8s.io/priority-class"]).toBe("low");
    expect(manifest.metadata.labels["canfar-net-sessionName"]).toBe("perfpulse-kueue-spot-kueue-0");
    expect(manifest.metadata.labels["canfar-net-sessionType"]).toBe("headless");
    expect(manifest.metadata.labels["canfar-net-userid"]).toBe("perfpulse-bucket-3");
    expect(manifest.metadata.labels[KUBERNETES_LABEL_KEYS.userBucket]).toBe("bucket-3");
    expect(manifest.metadata.labels["opencadc.org/canfar-job-fixed"]).toBe("true");
    expect(manifest.spec.suspend).toBe(true);
    expect(manifest.spec.backoffLimit).toBe(0);
    expect(manifest.spec.activeDeadlineSeconds).toBe(150);
    expect(manifest.spec.ttlSecondsAfterFinished).toBe(45);
    expect(manifest.spec.template.spec.securityContext).toEqual(restrictedPodSecurityContext);
    expect(manifest.spec.template.spec.containers[0]?.securityContext).toEqual(
      restrictedContainerSecurityContext,
    );
  });
});

const restrictedPodSecurityContext = {
  runAsGroup: 1000,
  runAsNonRoot: true,
  runAsUser: 1000,
  seccompProfile: {
    type: "RuntimeDefault",
  },
};

const restrictedContainerSecurityContext = {
  allowPrivilegeEscalation: false,
  capabilities: {
    drop: ["ALL"],
  },
  runAsGroup: 1000,
  runAsNonRoot: true,
  runAsUser: 1000,
  seccompProfile: {
    type: "RuntimeDefault",
  },
};
