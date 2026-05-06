import { describe, expect, test } from "bun:test";
import {
  buildHourlySpotTinySchedule,
  buildManualBenchmarkMediumDeployment,
  buildManualBenchmarkSmallDirectKueueDeployment,
  buildManualSpotDirectTinyDeployment,
  buildManualSpotKueueTinyDeployment,
  buildManualSpotSkahaTinyDeployment,
  buildManualSpotTinyDeployment,
  buildManualStressHighDeployment,
  buildManualStressMediumDeployment,
  DEFAULT_SKAHA_API_URL,
  renderManifestDocuments,
} from "../src/deployment-manifests";

const EXPECTED_DEFAULT_SKAHA_API_URL =
  "http://canfar-skaha-staging-skaha-tomcat-svc.canfar-system-staging.svc.keel-prod.local:8080/skaha/v1";

describe("deployment manifest contracts", () => {
  test("builds the manual M1 spot-direct-tiny TestRun contract", () => {
    const contract = buildManualSpotDirectTinyDeployment({
      imageTag: "2026.05.04",
      otlpCredentialsSecretName: "perfpulse-otlp-credentials",
      testid: "spot-direct-tiny-manual",
    });

    const resources = contract.resources;
    const controlNamespace = resource(resources, "Namespace", "canfar-perfpulse");
    const workloadNamespace = resource(resources, "Namespace", "canfar-workloads");
    const serviceAccount = resource(resources, "ServiceAccount", "canfar-perfpulse");
    const role = resource(resources, "Role", "perfpulse-workload-writer");
    const roleBinding = resource(resources, "RoleBinding", "perfpulse-workload-writer");
    const configMap = resource(resources, "ConfigMap", "perfpulse-spot-direct-tiny-config");
    const testRun = resource(resources, "TestRun", "perfpulse-spot-direct-tiny");

    expect(controlNamespace.metadata.namespace).toBeUndefined();
    expect(workloadNamespace.metadata.namespace).toBeUndefined();
    expect(serviceAccount.metadata.namespace).toBe("canfar-perfpulse");
    expect(role.metadata.namespace).toBe("canfar-workloads");
    expect(roleBinding.metadata.namespace).toBe("canfar-workloads");
    expect(roleBinding.subjects).toEqual([
      {
        kind: "ServiceAccount",
        name: "canfar-perfpulse",
        namespace: "canfar-perfpulse",
      },
    ]);

    expect(configMap.metadata.namespace).toBe("canfar-perfpulse");
    expect(configMap.data).toMatchObject({
      COMPLETION_GATE_SECONDS: "120",
      K6_OTEL_EXPORTER_PROTOCOL: "http/protobuf",
      K6_OTEL_HTTP_EXPORTER_ENDPOINT: "kube-prometheus-stack-prometheus.monitoring:9090",
      K6_OTEL_HTTP_EXPORTER_INSECURE: "true",
      K6_OTEL_HTTP_EXPORTER_URL_PATH: "/api/v1/otlp/v1/metrics",
      K6_OTEL_METRIC_PREFIX: "k6_",
      K6_OTEL_SERVICE_NAME: "perfpulse",
      K6_OTEL_EXPORT_INTERVAL: "5s",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      PROFILE: "spot-direct-tiny",
      RUN_CLASS: "spot",
      SURFACE: "k8s-direct",
      WORKLOAD_NAMESPACE: "canfar-workloads",
    });
    expect(Object.keys(configMap.data ?? {}).join("\n")).not.toMatch(
      /SECRET|AUTHORIZATION|BEARER/u,
    );
    expect(Object.values(configMap.data ?? {}).join("\n")).not.toMatch(
      /runtime-password|runtime-user|Bearer/u,
    );
    expect(Object.keys(configMap.data ?? {}).join("\n")).not.toMatch(/PROMETHEUS_RW/u);

    expect(testRun.metadata.namespace).toBe("canfar-perfpulse");
    expect(testRun.spec).toMatchObject({
      arguments: "-o opentelemetry",
      initializer: {
        containerSecurityContext: restrictedContainerSecurityContext,
        image: "images.opencadc.org/platform/perfpulse:2026.05.04",
        securityContext: restrictedPodSecurityContext,
        serviceAccountName: "canfar-perfpulse",
      },
      parallelism: 1,
      runner: {
        containerSecurityContext: restrictedContainerSecurityContext,
        image: "images.opencadc.org/platform/perfpulse:2026.05.04",
        securityContext: restrictedPodSecurityContext,
        serviceAccountName: "canfar-perfpulse",
      },
      script: {
        localFile: "/test/perfpulse.js",
      },
      starter: {
        containerSecurityContext: restrictedContainerSecurityContext,
        securityContext: restrictedPodSecurityContext,
        serviceAccountName: "canfar-perfpulse",
      },
    });
    expect((testRun.spec?.starter as Record<string, unknown>).image).toBeUndefined();
    expect((testRun.spec?.starter as Record<string, unknown>).envFrom).toBeUndefined();
    const testRunSpec = testRun.spec as {
      runner: {
        env: Array<{ name: string; value: string }>;
        envFrom: Array<Record<string, unknown>>;
      };
    };
    expect(testRunSpec.runner.env).toContainEqual({
      name: "TESTID",
      value: "spot-direct-tiny-manual",
    });
    expect(testRunSpec.runner.envFrom).toEqual([
      { configMapRef: { name: "perfpulse-spot-direct-tiny-config" } },
      { secretRef: { name: "perfpulse-otlp-credentials", optional: true } },
    ]);
    expect(renderManifestDocuments(contract)).not.toMatch(
      /experimental-prometheus-rw|K6_PROMETHEUS_RW/u,
    );
  });

  test("builds the manual M2 spot Kueue TestRun contract", () => {
    const contract = buildManualSpotKueueTinyDeployment({
      imageTag: "2026.05.04",
      otlpCredentialsSecretName: "perfpulse-otlp-credentials",
      testid: "spot-kueue-tiny-manual",
    });

    const resources = contract.resources;
    const role = resource(resources, "Role", "perfpulse-workload-writer");
    const configMap = resource(resources, "ConfigMap", "perfpulse-spot-kueue-tiny-config");
    const testRun = resource(resources, "TestRun", "perfpulse-spot-kueue-tiny");

    expect(role.metadata.namespace).toBe("canfar-workloads");
    expect(role.rules).toContainEqual({
      apiGroups: ["batch"],
      resources: ["jobs"],
      verbs: ["create", "delete", "get", "list"],
    });
    expect(role.rules).toContainEqual({
      apiGroups: ["kueue.x-k8s.io"],
      resources: ["workloads"],
      verbs: ["get", "list"],
    });
    expect(configMap.metadata.namespace).toBe("canfar-perfpulse");
    expect(configMap.data).toMatchObject({
      KUEUE_ADMISSION_GATE_SECONDS: "120",
      KUEUE_PRIORITY_CLASS: "low",
      KUEUE_QUEUE_NAME: "cadc-default",
      K6_OTEL_EXPORT_INTERVAL: "1s",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      PROFILE: "spot-tiny",
      RUN_CLASS: "spot",
      SURFACE: "k8s-kueue",
      WORKLOAD_NAMESPACE: "canfar-workloads",
    });
    expect(testRun.metadata.namespace).toBe("canfar-perfpulse");
    expect(testRun.spec).toMatchObject({
      arguments: "-o opentelemetry",
      parallelism: 1,
      runner: {
        image: "images.opencadc.org/platform/perfpulse:2026.05.04",
        serviceAccountName: "canfar-perfpulse",
      },
    });
    const testRunSpec = testRun.spec as {
      runner: {
        env: Array<{ name: string; value: string }>;
        envFrom: Array<Record<string, unknown>>;
      };
    };
    expect(testRunSpec.runner.env).toContainEqual({
      name: "TESTID",
      value: "spot-kueue-tiny-manual",
    });
    expect(testRunSpec.runner.envFrom).toEqual([
      { configMapRef: { name: "perfpulse-spot-kueue-tiny-config" } },
      { secretRef: { name: "perfpulse-otlp-credentials", optional: true } },
    ]);
  });

  test("builds the manual benchmark-small Direct, Kueue, and Skaha TestRun contract", () => {
    const contract = buildManualBenchmarkSmallDirectKueueDeployment({
      imageTag: "2026.05.04",
      otlpCredentialsSecretName: "perfpulse-otlp-credentials",
      testid: "benchmark-small-manual",
    });

    const resources = contract.resources;
    const role = resource(resources, "Role", "perfpulse-workload-writer");
    const directConfig = resource(
      resources,
      "ConfigMap",
      "perfpulse-benchmark-small-direct-config",
    );
    const kueueConfig = resource(resources, "ConfigMap", "perfpulse-benchmark-small-kueue-config");
    const skahaConfig = resource(resources, "ConfigMap", "perfpulse-benchmark-small-skaha-config");
    const directTestRun = resource(resources, "TestRun", "perfpulse-benchmark-small-direct");
    const kueueTestRun = resource(resources, "TestRun", "perfpulse-benchmark-small-kueue");
    const skahaTestRun = resource(resources, "TestRun", "perfpulse-benchmark-small-skaha");

    expect(role.metadata.namespace).toBe("canfar-workloads");
    expect(role.rules).toContainEqual({
      apiGroups: ["batch"],
      resources: ["jobs"],
      verbs: ["create", "delete", "get", "list"],
    });
    expect(role.rules).toContainEqual({
      apiGroups: ["kueue.x-k8s.io"],
      resources: ["workloads"],
      verbs: ["get", "list"],
    });

    for (const configMap of [directConfig, kueueConfig]) {
      expect(configMap.metadata.namespace).toBe("canfar-perfpulse");
      expect(configMap.data).toMatchObject({
        CLEANUP: "true",
        COMPLETION_GATE_SECONDS: "300",
        K6_OTEL_EXPORTER_PROTOCOL: "http/protobuf",
        K6_OTEL_HTTP_EXPORTER_ENDPOINT: "kube-prometheus-stack-prometheus.monitoring:9090",
        K6_OTEL_HTTP_EXPORTER_INSECURE: "true",
        K6_OTEL_HTTP_EXPORTER_URL_PATH: "/api/v1/otlp/v1/metrics",
        K6_OTEL_METRIC_PREFIX: "k6_",
        K6_OTEL_EXPORT_INTERVAL: "1s",
        LOGICAL_USERS: "100",
        PERF_PULSE_CLIENT_MODE: "kubernetes",
        PROFILE: "benchmark-small",
        RUN_CLASS: "benchmark",
        SCENARIO: "many-small-users",
        TOTAL_JOBS: "100",
        VISIBILITY_GATE_SECONDS: "120",
        WORKLOAD_NAMESPACE: "canfar-workloads",
      });
    }
    expect(directConfig.data).toMatchObject({
      K6_OTEL_SERVICE_NAME: "perfpulse-benchmark-small-direct",
      SURFACE: "k8s-direct",
    });
    expect(kueueConfig.data).toMatchObject({
      K6_OTEL_SERVICE_NAME: "perfpulse-benchmark-small-kueue",
      KUEUE_ADMISSION_GATE_SECONDS: "300",
      KUEUE_PRIORITY_CLASS: "low",
      KUEUE_QUEUE_NAME: "cadc-default",
      SURFACE: "k8s-kueue",
    });
    expect(skahaConfig.data).toMatchObject({
      K6_OTEL_SERVICE_NAME: "perfpulse-benchmark-small-skaha",
      SKAHA_API_URL: EXPECTED_DEFAULT_SKAHA_API_URL,
      SKAHA_LOGIN_URL: "https://ws-cadc.canfar.net/ac/login",
      SKAHA_PASSWORD_PATH: "/var/run/secrets/perfpulse/skaha-auth/password",
      SKAHA_REQUEST_TIMEOUT_SECONDS: "120",
      SKAHA_USERNAME_PATH: "/var/run/secrets/perfpulse/skaha-auth/username",
      SUBMISSION_STAGGER_SECONDS: "1",
      SURFACE: "skaha",
    });
    expect(Object.keys(directConfig.data ?? {}).join("\n")).not.toMatch(/KUEUE_/u);
    expect(Object.keys(skahaConfig.data ?? {}).join("\n")).not.toMatch(/KUEUE_|WORKLOAD/u);

    for (const testRun of [directTestRun, kueueTestRun, skahaTestRun]) {
      expect(testRun.metadata.namespace).toBe("canfar-perfpulse");
      expect(testRun.spec).toMatchObject({
        arguments: "-o opentelemetry",
        parallelism: 1,
        runner: {
          image: "images.opencadc.org/platform/perfpulse:2026.05.04",
          serviceAccountName: "canfar-perfpulse",
        },
      });
      const testRunSpec = testRun.spec as {
        runner: {
          env: Array<{ name: string; value: string }>;
          envFrom: Array<Record<string, unknown>>;
        };
      };
      expect(testRunSpec.runner.env).toContainEqual({
        name: "TESTID",
        value: "benchmark-small-manual",
      });
      expect(testRunSpec.runner.envFrom).toContainEqual({
        secretRef: { name: "perfpulse-otlp-credentials", optional: true },
      });
    }
    expect(
      (directTestRun.spec?.runner as { envFrom: Array<Record<string, unknown>> }).envFrom,
    ).toContainEqual({
      configMapRef: { name: "perfpulse-benchmark-small-direct-config" },
    });
    expect(
      (kueueTestRun.spec?.runner as { envFrom: Array<Record<string, unknown>> }).envFrom,
    ).toContainEqual({
      configMapRef: { name: "perfpulse-benchmark-small-kueue-config" },
    });
    const skahaRunner = skahaTestRun.spec?.runner as {
      envFrom: Array<Record<string, unknown>>;
      volumeMounts?: Array<Record<string, unknown>>;
      volumes?: Array<Record<string, unknown>>;
    };
    expect(skahaRunner.envFrom).toContainEqual({
      configMapRef: { name: "perfpulse-benchmark-small-skaha-config" },
    });
    expect(skahaRunner.volumeMounts).toContainEqual({
      mountPath: "/var/run/secrets/perfpulse/skaha-auth",
      name: "skaha-auth-credentials",
      readOnly: true,
    });
    expect(skahaRunner.volumes).toContainEqual({
      name: "skaha-auth-credentials",
      secret: { secretName: "perfpulse-skaha-auth" },
    });
    expect(renderManifestDocuments(contract)).not.toMatch(/Authorization|kind: Secret/u);
  });

  test("builds the manual multi-surface spot-tiny TestRun contract", () => {
    const contract = buildManualSpotTinyDeployment({
      imageTag: "2026.05.04",
      otlpCredentialsSecretName: "perfpulse-otlp-credentials",
      testid: "spot-tiny-manual",
    });

    const resources = contract.resources;
    const role = resource(resources, "Role", "perfpulse-workload-writer");
    const directConfig = resource(resources, "ConfigMap", "perfpulse-spot-tiny-direct-config");
    const kueueConfig = resource(resources, "ConfigMap", "perfpulse-spot-tiny-kueue-config");
    const skahaConfig = resource(resources, "ConfigMap", "perfpulse-spot-tiny-skaha-config");
    const directTestRun = resource(resources, "TestRun", "perfpulse-spot-tiny-direct");
    const kueueTestRun = resource(resources, "TestRun", "perfpulse-spot-tiny-kueue");
    const skahaTestRun = resource(resources, "TestRun", "perfpulse-spot-tiny-skaha");

    expect(role.rules).toContainEqual({
      apiGroups: ["batch"],
      resources: ["jobs"],
      verbs: ["create", "delete", "get", "list"],
    });
    expect(role.rules).toContainEqual({
      apiGroups: ["kueue.x-k8s.io"],
      resources: ["workloads"],
      verbs: ["get", "list"],
    });

    expect(directConfig.data).toMatchObject({
      CLEANUP: "true",
      COMPLETION_GATE_SECONDS: "120",
      K6_OTEL_EXPORT_INTERVAL: "1s",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      PROFILE: "spot-tiny",
      RUN_CLASS: "spot",
      SURFACE: "k8s-direct",
      VISIBILITY_GATE_SECONDS: "60",
      WORKLOAD_NAMESPACE: "canfar-workloads",
    });
    expect(kueueConfig.data).toMatchObject({
      CLEANUP: "true",
      COMPLETION_GATE_SECONDS: "120",
      KUEUE_ADMISSION_GATE_SECONDS: "120",
      KUEUE_PRIORITY_CLASS: "low",
      KUEUE_QUEUE_NAME: "cadc-default",
      K6_OTEL_EXPORT_INTERVAL: "1s",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      PROFILE: "spot-tiny",
      RUN_CLASS: "spot",
      SURFACE: "k8s-kueue",
      VISIBILITY_GATE_SECONDS: "60",
      WORKLOAD_NAMESPACE: "canfar-workloads",
    });
    expect(skahaConfig.data).toMatchObject({
      CLEANUP: "true",
      COMPLETION_GATE_SECONDS: "120",
      K6_OTEL_EXPORT_INTERVAL: "1s",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      PROFILE: "spot-tiny",
      RUN_CLASS: "spot",
      SKAHA_API_URL: EXPECTED_DEFAULT_SKAHA_API_URL,
      SKAHA_LOGIN_URL: "https://ws-cadc.canfar.net/ac/login",
      SKAHA_PASSWORD_PATH: "/var/run/secrets/perfpulse/skaha-auth/password",
      SKAHA_USERNAME_PATH: "/var/run/secrets/perfpulse/skaha-auth/username",
      SURFACE: "skaha",
      VISIBILITY_GATE_SECONDS: "60",
    });
    expect(Object.keys(directConfig.data ?? {}).join("\n")).not.toMatch(/KUEUE_|SKAHA_/u);
    expect(Object.keys(skahaConfig.data ?? {}).join("\n")).not.toMatch(/KUEUE_|WORKLOAD/u);

    for (const testRun of [directTestRun, kueueTestRun, skahaTestRun]) {
      const runner = testRun.spec?.runner as {
        env: Array<{ name: string; value: string }>;
        envFrom: Array<Record<string, unknown>>;
      };
      expect(runner.env).toContainEqual({ name: "TESTID", value: "spot-tiny-manual" });
      expect(runner.envFrom).toContainEqual({
        secretRef: { name: "perfpulse-otlp-credentials", optional: true },
      });
    }
    expect(
      (directTestRun.spec?.runner as { envFrom: Array<Record<string, unknown>> }).envFrom,
    ).toContainEqual({
      configMapRef: { name: "perfpulse-spot-tiny-direct-config" },
    });
    expect(
      (kueueTestRun.spec?.runner as { envFrom: Array<Record<string, unknown>> }).envFrom,
    ).toContainEqual({
      configMapRef: { name: "perfpulse-spot-tiny-kueue-config" },
    });
    const skahaRunner = skahaTestRun.spec?.runner as {
      envFrom: Array<Record<string, unknown>>;
      volumeMounts?: Array<Record<string, unknown>>;
      volumes?: Array<Record<string, unknown>>;
    };
    expect(skahaRunner.envFrom).toContainEqual({
      configMapRef: { name: "perfpulse-spot-tiny-skaha-config" },
    });
    expect(skahaRunner.volumeMounts).toContainEqual({
      mountPath: "/var/run/secrets/perfpulse/skaha-auth",
      name: "skaha-auth-credentials",
      readOnly: true,
    });
    expect(skahaRunner.volumes).toContainEqual({
      name: "skaha-auth-credentials",
      secret: { secretName: "perfpulse-skaha-auth" },
    });
  });

  test("builds the manual benchmark-medium Direct, Kueue, and Skaha TestRun contract", () => {
    const contract = buildManualBenchmarkMediumDeployment({
      imageTag: "2026.05.04",
      otlpCredentialsSecretName: "perfpulse-otlp-credentials",
      testid: "benchmark-medium-manual",
    });

    const resources = contract.resources;
    const directConfig = resource(
      resources,
      "ConfigMap",
      "perfpulse-benchmark-medium-direct-config",
    );
    const kueueConfig = resource(resources, "ConfigMap", "perfpulse-benchmark-medium-kueue-config");
    const skahaConfig = resource(resources, "ConfigMap", "perfpulse-benchmark-medium-skaha-config");
    const directTestRun = resource(resources, "TestRun", "perfpulse-benchmark-medium-direct");
    const kueueTestRun = resource(resources, "TestRun", "perfpulse-benchmark-medium-kueue");
    const skahaTestRun = resource(resources, "TestRun", "perfpulse-benchmark-medium-skaha");

    for (const configMap of [directConfig, kueueConfig, skahaConfig]) {
      expect(configMap.data).toMatchObject({
        CLEANUP: "true",
        COMPLETION_GATE_SECONDS: "900",
        K6_OTEL_EXPORT_INTERVAL: "5s",
        LOGICAL_USERS: "100",
        PERF_PULSE_CLIENT_MODE: "kubernetes",
        PROFILE: "benchmark-medium",
        RUN_CLASS: "benchmark",
        SCENARIO: "many-small-users",
        TOTAL_JOBS: "1000",
        VISIBILITY_GATE_SECONDS: "300",
      });
    }
    expect(directConfig.data).toMatchObject({
      K6_OTEL_SERVICE_NAME: "perfpulse-benchmark-medium-direct",
      SURFACE: "k8s-direct",
      WORKLOAD_NAMESPACE: "canfar-workloads",
    });
    expect(kueueConfig.data).toMatchObject({
      K6_OTEL_SERVICE_NAME: "perfpulse-benchmark-medium-kueue",
      KUEUE_ADMISSION_GATE_SECONDS: "900",
      KUEUE_PRIORITY_CLASS: "low",
      KUEUE_QUEUE_NAME: "cadc-default",
      SURFACE: "k8s-kueue",
      WORKLOAD_NAMESPACE: "canfar-workloads",
    });
    expect(skahaConfig.data).toMatchObject({
      K6_OTEL_SERVICE_NAME: "perfpulse-benchmark-medium-skaha",
      SKAHA_API_URL: EXPECTED_DEFAULT_SKAHA_API_URL,
      SKAHA_LOGIN_URL: "https://ws-cadc.canfar.net/ac/login",
      SKAHA_PASSWORD_PATH: "/var/run/secrets/perfpulse/skaha-auth/password",
      SKAHA_REQUEST_TIMEOUT_SECONDS: "120",
      SKAHA_USERNAME_PATH: "/var/run/secrets/perfpulse/skaha-auth/username",
      SUBMISSION_STAGGER_SECONDS: "1",
      SURFACE: "skaha",
    });

    for (const testRun of [directTestRun, kueueTestRun, skahaTestRun]) {
      const runner = testRun.spec?.runner as {
        env: Array<{ name: string; value: string }>;
        envFrom: Array<Record<string, unknown>>;
      };
      expect(runner.env).toContainEqual({ name: "TESTID", value: "benchmark-medium-manual" });
      expect(runner.envFrom).toContainEqual({
        secretRef: { name: "perfpulse-otlp-credentials", optional: true },
      });
    }
  });

  test("builds the manual stress-medium Direct, Kueue, and Skaha TestRun contract", () => {
    const contract = buildManualStressMediumDeployment({
      imageTag: "2026.05.04",
      otlpCredentialsSecretName: "perfpulse-otlp-credentials",
      testid: "stress-medium-manual",
    });

    const resources = contract.resources;
    const directConfig = resource(resources, "ConfigMap", "perfpulse-stress-medium-direct-config");
    const kueueConfig = resource(resources, "ConfigMap", "perfpulse-stress-medium-kueue-config");
    const skahaConfig = resource(resources, "ConfigMap", "perfpulse-stress-medium-skaha-config");
    const directTestRun = resource(resources, "TestRun", "perfpulse-stress-medium-direct");
    const kueueTestRun = resource(resources, "TestRun", "perfpulse-stress-medium-kueue");
    const skahaTestRun = resource(resources, "TestRun", "perfpulse-stress-medium-skaha");

    for (const configMap of [directConfig, kueueConfig, skahaConfig]) {
      expect(configMap.data).toMatchObject({
        CLEANUP: "true",
        CONFIRM_STRESS: "true",
        K6_OTEL_EXPORT_INTERVAL: "15s",
        LOGICAL_USERS: "100",
        PERF_PULSE_CLIENT_MODE: "kubernetes",
        PRESERVE_ON_FAILURE: "false",
        PROFILE: "stress-medium",
        RUN_CLASS: "stress",
        SCENARIO: "throughput-stress",
        TOTAL_JOBS: "10000",
        VISIBILITY_GATE_SECONDS: "900",
      });
    }
    expect(directConfig.data).toMatchObject({
      K6_OTEL_SERVICE_NAME: "perfpulse-stress-medium-direct",
      SURFACE: "k8s-direct",
      WORKLOAD_NAMESPACE: "canfar-workloads",
    });
    expect(kueueConfig.data).toMatchObject({
      K6_OTEL_SERVICE_NAME: "perfpulse-stress-medium-kueue",
      KUEUE_ADMISSION_GATE_SECONDS: "900",
      KUEUE_PRIORITY_CLASS: "low",
      KUEUE_QUEUE_NAME: "cadc-default",
      SURFACE: "k8s-kueue",
      WORKLOAD_NAMESPACE: "canfar-workloads",
    });
    expect(skahaConfig.data).toMatchObject({
      K6_OTEL_SERVICE_NAME: "perfpulse-stress-medium-skaha",
      SKAHA_API_URL: EXPECTED_DEFAULT_SKAHA_API_URL,
      SKAHA_LOGIN_URL: "https://ws-cadc.canfar.net/ac/login",
      SKAHA_PASSWORD_PATH: "/var/run/secrets/perfpulse/skaha-auth/password",
      SKAHA_REQUEST_TIMEOUT_SECONDS: "120",
      SKAHA_USERNAME_PATH: "/var/run/secrets/perfpulse/skaha-auth/username",
      SURFACE: "skaha",
    });

    for (const testRun of [directTestRun, kueueTestRun, skahaTestRun]) {
      const runner = testRun.spec?.runner as {
        env: Array<{ name: string; value: string }>;
        envFrom: Array<Record<string, unknown>>;
      };
      expect(runner.env).toContainEqual({ name: "TESTID", value: "stress-medium-manual" });
      expect(runner.envFrom).toContainEqual({
        secretRef: { name: "perfpulse-otlp-credentials", optional: true },
      });
    }
  });

  test("builds the manual stress-high Kueue-only TestRun contract by default", () => {
    const contract = buildManualStressHighDeployment({
      imageTag: "2026.05.04",
      otlpCredentialsSecretName: "perfpulse-otlp-credentials",
      testid: "stress-high-manual",
    });

    const resources = contract.resources;
    const kueueConfig = resource(resources, "ConfigMap", "perfpulse-stress-high-kueue-config");
    const kueueTestRun = resource(resources, "TestRun", "perfpulse-stress-high-kueue");

    expect(resources.some((item) => item.metadata.name === "perfpulse-stress-high-direct")).toBe(
      false,
    );
    expect(resources.some((item) => item.metadata.name === "perfpulse-stress-high-skaha")).toBe(
      false,
    );
    expect(kueueConfig.data).toMatchObject({
      CLEANUP: "true",
      CONFIRM_STRESS: "true",
      K6_OTEL_EXPORT_INTERVAL: "30s",
      K6_OTEL_SERVICE_NAME: "perfpulse-stress-high-kueue",
      KUEUE_ADMISSION_GATE_SECONDS: "1800",
      KUEUE_PRIORITY_CLASS: "low",
      KUEUE_QUEUE_NAME: "cadc-default",
      LOGICAL_USERS: "100",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      PRESERVE_ON_FAILURE: "false",
      PROFILE: "stress-high",
      RUN_CLASS: "stress",
      SCENARIO: "throughput-stress",
      SURFACE: "k8s-kueue",
      TOTAL_JOBS: "100000",
      VISIBILITY_GATE_SECONDS: "1800",
      WORKLOAD_NAMESPACE: "canfar-workloads",
    });

    const runner = kueueTestRun.spec?.runner as {
      env: Array<{ name: string; value: string }>;
      envFrom: Array<Record<string, unknown>>;
    };
    expect(runner.env).toContainEqual({ name: "TESTID", value: "stress-high-manual" });
    expect(runner.envFrom).toEqual([
      { configMapRef: { name: "perfpulse-stress-high-kueue-config" } },
      { secretRef: { name: "perfpulse-otlp-credentials", optional: true } },
    ]);
  });

  test("builds the manual Skaha spot-tiny TestRun contract", () => {
    const contract = buildManualSpotSkahaTinyDeployment({
      imageTag: "2026.05.04",
      otlpCredentialsSecretName: "perfpulse-otlp-credentials",
      testid: "spot-skaha-tiny-manual",
    });

    const resources = contract.resources;
    const controlNamespace = resource(resources, "Namespace", "canfar-perfpulse");
    const workloadRole = resources.find(
      (item) =>
        item.kind === "Role" &&
        item.metadata.namespace === "canfar-workloads" &&
        item.metadata.name === "perfpulse-workload-writer",
    );
    const serviceAccount = resource(resources, "ServiceAccount", "canfar-perfpulse");
    const configMap = resource(resources, "ConfigMap", "perfpulse-spot-skaha-tiny-config");
    const testRun = resource(resources, "TestRun", "perfpulse-spot-skaha-tiny");

    expect(controlNamespace.metadata.namespace).toBeUndefined();
    expect(workloadRole).toBeUndefined();
    expect(serviceAccount.metadata.namespace).toBe("canfar-perfpulse");

    expect(configMap.metadata.namespace).toBe("canfar-perfpulse");
    expect(configMap.data).toMatchObject({
      CLEANUP: "true",
      COMPLETION_GATE_SECONDS: "120",
      K6_OTEL_EXPORTER_PROTOCOL: "http/protobuf",
      K6_OTEL_HTTP_EXPORTER_ENDPOINT: "kube-prometheus-stack-prometheus.monitoring:9090",
      K6_OTEL_HTTP_EXPORTER_INSECURE: "true",
      K6_OTEL_HTTP_EXPORTER_URL_PATH: "/api/v1/otlp/v1/metrics",
      K6_OTEL_METRIC_PREFIX: "k6_",
      K6_OTEL_SERVICE_NAME: "perfpulse",
      K6_OTEL_EXPORT_INTERVAL: "1s",
      PERF_PULSE_CLIENT_MODE: "kubernetes",
      PROFILE: "spot-tiny",
      RUN_CLASS: "spot",
      SKAHA_API_URL: EXPECTED_DEFAULT_SKAHA_API_URL,
      SKAHA_LOGIN_URL: "https://ws-cadc.canfar.net/ac/login",
      SKAHA_PASSWORD_PATH: "/var/run/secrets/perfpulse/skaha-auth/password",
      SKAHA_USERNAME_PATH: "/var/run/secrets/perfpulse/skaha-auth/username",
      SURFACE: "skaha",
      VISIBILITY_GATE_SECONDS: "60",
    });
    expect(DEFAULT_SKAHA_API_URL).toBe(EXPECTED_DEFAULT_SKAHA_API_URL);
    expect(Object.keys(configMap.data ?? {}).join("\n")).not.toMatch(
      /SECRET|AUTHORIZATION|BEARER/u,
    );
    expect(Object.values(configMap.data ?? {}).join("\n")).not.toMatch(
      /runtime-password|runtime-user|Bearer/u,
    );

    expect(testRun.metadata.namespace).toBe("canfar-perfpulse");
    expect(testRun.spec).toMatchObject({
      arguments: "-o opentelemetry",
      initializer: {
        containerSecurityContext: restrictedContainerSecurityContext,
        image: "images.opencadc.org/platform/perfpulse:2026.05.04",
        securityContext: restrictedPodSecurityContext,
        serviceAccountName: "canfar-perfpulse",
      },
      parallelism: 1,
      runner: {
        containerSecurityContext: restrictedContainerSecurityContext,
        image: "images.opencadc.org/platform/perfpulse:2026.05.04",
        securityContext: restrictedPodSecurityContext,
        serviceAccountName: "canfar-perfpulse",
      },
      script: {
        localFile: "/test/perfpulse.js",
      },
      starter: {
        containerSecurityContext: restrictedContainerSecurityContext,
        securityContext: restrictedPodSecurityContext,
        serviceAccountName: "canfar-perfpulse",
      },
    });
    const testRunSpec = testRun.spec as {
      runner: {
        env: Array<{ name: string; value: string }>;
        envFrom: Array<Record<string, unknown>>;
        volumeMounts?: Array<Record<string, unknown>>;
        volumes?: Array<Record<string, unknown>>;
      };
    };
    expect(testRunSpec.runner.env).toContainEqual({
      name: "TESTID",
      value: "spot-skaha-tiny-manual",
    });
    expect(testRunSpec.runner.envFrom).toEqual([
      { configMapRef: { name: "perfpulse-spot-skaha-tiny-config" } },
      { secretRef: { name: "perfpulse-otlp-credentials", optional: true } },
    ]);
    expect(testRunSpec.runner.volumeMounts).toContainEqual({
      mountPath: "/var/run/secrets/perfpulse/skaha-auth",
      name: "skaha-auth-credentials",
      readOnly: true,
    });
    expect(testRunSpec.runner.volumes).toContainEqual({
      name: "skaha-auth-credentials",
      secret: { secretName: "perfpulse-skaha-auth" },
    });
    expect(renderManifestDocuments(contract)).not.toMatch(/Authorization|kind: Secret/u);
  });

  test("preserves an explicit Skaha API URL override in the manual Skaha manifest", () => {
    const contract = buildManualSpotSkahaTinyDeployment({
      imageTag: "2026.05.04",
      skahaApiUrl: "https://ws.example/skaha/v1",
      testid: "spot-skaha-tiny-manual",
    });

    const configMap = resource(contract.resources, "ConfigMap", "perfpulse-spot-skaha-tiny-config");

    expect(configMap.data?.SKAHA_API_URL).toBe("https://ws.example/skaha/v1");
  });

  test("builds an hourly non-overlapping spot-tiny CronJob contract", () => {
    const contract = buildHourlySpotTinySchedule({
      imageTag: "2026.05.04",
      kubectlImage: "docker.io/bitnami/kubectl:1.31",
      otlpCredentialsSecretName: "perfpulse-otlp-credentials",
    });

    const resources = contract.resources;
    const cronJob = resource(resources, "CronJob", "perfpulse-spot-tiny-hourly");
    const workloadRole = resource(resources, "Role", "perfpulse-workload-writer");
    const controlRole = resource(resources, "Role", "perfpulse-testrun-writer");
    const controlRoleBinding = resource(resources, "RoleBinding", "perfpulse-testrun-writer");
    const directConfig = resource(resources, "ConfigMap", "perfpulse-spot-tiny-direct-config");
    const kueueConfig = resource(resources, "ConfigMap", "perfpulse-spot-tiny-kueue-config");
    const skahaConfig = resource(resources, "ConfigMap", "perfpulse-spot-tiny-skaha-config");

    expect(workloadRole.rules).toContainEqual({
      apiGroups: ["kueue.x-k8s.io"],
      resources: ["workloads"],
      verbs: ["get", "list"],
    });
    expect(controlRole.metadata.namespace).toBe("canfar-perfpulse");
    expect(controlRole.rules).toContainEqual({
      apiGroups: ["k6.io"],
      resources: ["testruns"],
      verbs: ["create", "delete", "get", "list", "patch"],
    });
    expect(controlRoleBinding.subjects).toEqual([
      {
        kind: "ServiceAccount",
        name: "canfar-perfpulse",
        namespace: "canfar-perfpulse",
      },
    ]);
    expect(directConfig.data).toMatchObject({
      PROFILE: "spot-tiny",
      RUN_CLASS: "spot",
      SURFACE: "k8s-direct",
    });
    expect(kueueConfig.data).toMatchObject({
      KUEUE_ADMISSION_GATE_SECONDS: "120",
      PROFILE: "spot-tiny",
      RUN_CLASS: "spot",
      SURFACE: "k8s-kueue",
    });
    expect(skahaConfig.data).toMatchObject({
      PROFILE: "spot-tiny",
      RUN_CLASS: "spot",
      SKAHA_PASSWORD_PATH: "/var/run/secrets/perfpulse/skaha-auth/password",
      SKAHA_USERNAME_PATH: "/var/run/secrets/perfpulse/skaha-auth/username",
      SURFACE: "skaha",
    });

    expect(cronJob.metadata.namespace).toBe("canfar-perfpulse");
    expect(cronJob.spec).toMatchObject({
      concurrencyPolicy: "Forbid",
      schedule: "0 * * * *",
      successfulJobsHistoryLimit: 1,
    });

    const jobTemplate = cronJob.spec?.jobTemplate as Record<string, unknown>;
    const jobSpec = (jobTemplate.spec as Record<string, unknown>).template as Record<
      string,
      unknown
    >;
    const podSpec = jobSpec.spec as Record<string, unknown>;
    const containers = podSpec.containers as Array<{ args: string[]; image: string; name: string }>;
    const createCommand = containers[0]?.args.join("\n") ?? "";

    expect(podSpec.serviceAccountName).toBe("canfar-perfpulse");
    expect(containers[0]?.image).toBe("docker.io/bitnami/kubectl:1.31");
    expect(createCommand).toContain('TESTID="spot-tiny-$(date -u +%Y%m%d%H%M%S)"');
    expect(createCommand).toContain(`name: perfpulse-spot-tiny-direct-$${"{TESTID}"}`);
    expect(createCommand).toContain(`name: perfpulse-spot-tiny-kueue-$${"{TESTID}"}`);
    expect(createCommand).toContain(`name: perfpulse-spot-tiny-skaha-$${"{TESTID}"}`);
    expect(createCommand).toContain("name: perfpulse-spot-tiny-direct-config");
    expect(createCommand).toContain("name: perfpulse-spot-tiny-kueue-config");
    expect(createCommand).toContain("name: perfpulse-spot-tiny-skaha-config");
    expect(createCommand).toContain('arguments: "-o opentelemetry"');
    expect(createCommand).toContain("initializer:");
    expect(createCommand).toContain("image: images.opencadc.org/platform/perfpulse:2026.05.04");
    expect(createCommand).toContain("serviceAccountName: canfar-perfpulse");
    expect(createCommand).toContain("securityContext:");
    expect(createCommand).toContain("runAsNonRoot: true");
    expect(createCommand).toContain("runAsUser: 1000");
    expect(createCommand).toContain("runAsGroup: 1000");
    expect(createCommand).toContain("seccompProfile:");
    expect(createCommand).toContain("type: RuntimeDefault");
    expect(createCommand).toContain("containerSecurityContext:");
    expect(createCommand).toContain("allowPrivilegeEscalation: false");
    expect(createCommand).toContain("capabilities:");
    expect(createCommand).toContain("drop:");
    expect(createCommand).toContain("- ALL");
    expect(createCommand).toContain(
      "\n      - secretRef:\n          name: perfpulse-otlp-credentials",
    );
    expect(createCommand).toContain("mountPath: /var/run/secrets/perfpulse/skaha-auth");
    expect(createCommand).toContain("secretName: perfpulse-skaha-auth");
    expect(createCommand).toContain("spot-tiny");
    expect(createCommand).not.toMatch(/benchmark|stress/u);
    expect(starterBlock(createCommand)).not.toContain(
      "image: images.opencadc.org/platform/perfpulse",
    );
    expect(starterBlock(createCommand)).not.toContain("envFrom:");
    expect(renderManifestDocuments(contract)).not.toMatch(
      /experimental-prometheus-rw|K6_PROMETHEUS_RW/u,
    );
  });

  test("keeps checked-in YAML examples synchronized with the public contract", async () => {
    const manualYaml = await Bun.file("docs/manifests/perfpulse-m1-spot-direct-tiny.yaml").text();
    const kueueYaml = await Bun.file("docs/manifests/perfpulse-m2-spot-kueue-tiny.yaml").text();
    const spotTinyYaml = await Bun.file("docs/manifests/perfpulse-spot-tiny.yaml").text();
    const benchmarkSmallYaml = await Bun.file(
      "docs/manifests/perfpulse-benchmark-small-direct-kueue.yaml",
    ).text();
    const benchmarkMediumYaml = await Bun.file(
      "docs/manifests/perfpulse-benchmark-medium.yaml",
    ).text();
    const stressMediumYaml = await Bun.file("docs/manifests/perfpulse-stress-medium.yaml").text();
    const stressHighYaml = await Bun.file("docs/manifests/perfpulse-stress-high.yaml").text();
    const hourlyYaml = await Bun.file("docs/manifests/perfpulse-spot-tiny-hourly.yaml").text();
    const skahaYaml = await Bun.file("docs/manifests/perfpulse-skaha-spot-tiny.yaml").text();

    expect(manualYaml).toBe(
      renderManifestDocuments(
        buildManualSpotDirectTinyDeployment({
          imageTag: "TAG",
          otlpCredentialsSecretName: "perfpulse-otlp-credentials",
          testid: "spot-direct-tiny-manual",
        }),
      ),
    );
    expect(hourlyYaml).toBe(
      renderManifestDocuments(
        buildHourlySpotTinySchedule({
          imageTag: "TAG",
          kubectlImage: "docker.io/bitnami/kubectl:1.31",
          otlpCredentialsSecretName: "perfpulse-otlp-credentials",
        }),
      ),
    );
    expect(kueueYaml).toBe(
      renderManifestDocuments(
        buildManualSpotKueueTinyDeployment({
          imageTag: "TAG",
          otlpCredentialsSecretName: "perfpulse-otlp-credentials",
          testid: "spot-kueue-tiny-manual",
        }),
      ),
    );
    expect(spotTinyYaml).toBe(
      renderManifestDocuments(
        buildManualSpotTinyDeployment({
          imageTag: "TAG",
          otlpCredentialsSecretName: "perfpulse-otlp-credentials",
          testid: "spot-tiny-manual",
        }),
      ),
    );
    expect(benchmarkSmallYaml).toBe(
      renderManifestDocuments(
        buildManualBenchmarkSmallDirectKueueDeployment({
          imageTag: "TAG",
          otlpCredentialsSecretName: "perfpulse-otlp-credentials",
          testid: "benchmark-small-manual",
        }),
      ),
    );
    expect(benchmarkMediumYaml).toBe(
      renderManifestDocuments(
        buildManualBenchmarkMediumDeployment({
          imageTag: "TAG",
          otlpCredentialsSecretName: "perfpulse-otlp-credentials",
          testid: "benchmark-medium-manual",
        }),
      ),
    );
    expect(stressMediumYaml).toBe(
      renderManifestDocuments(
        buildManualStressMediumDeployment({
          imageTag: "TAG",
          otlpCredentialsSecretName: "perfpulse-otlp-credentials",
          testid: "stress-medium-manual",
        }),
      ),
    );
    expect(stressHighYaml).toBe(
      renderManifestDocuments(
        buildManualStressHighDeployment({
          imageTag: "TAG",
          otlpCredentialsSecretName: "perfpulse-otlp-credentials",
          testid: "stress-high-manual",
        }),
      ),
    );
    expect(skahaYaml).toBe(
      renderManifestDocuments(
        buildManualSpotSkahaTinyDeployment({
          imageTag: "TAG",
          otlpCredentialsSecretName: "perfpulse-otlp-credentials",
          testid: "spot-skaha-tiny-manual",
        }),
      ),
    );
  });
});

type ContractResource =
  | ReturnType<typeof buildManualBenchmarkMediumDeployment>["resources"][number]
  | ReturnType<typeof buildManualBenchmarkSmallDirectKueueDeployment>["resources"][number]
  | ReturnType<typeof buildManualSpotTinyDeployment>["resources"][number]
  | ReturnType<typeof buildManualSpotDirectTinyDeployment>["resources"][number]
  | ReturnType<typeof buildManualSpotKueueTinyDeployment>["resources"][number]
  | ReturnType<typeof buildManualSpotSkahaTinyDeployment>["resources"][number]
  | ReturnType<typeof buildManualStressHighDeployment>["resources"][number]
  | ReturnType<typeof buildManualStressMediumDeployment>["resources"][number]
  | ReturnType<typeof buildHourlySpotTinySchedule>["resources"][number];

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

function resource(
  resources: ContractResource[],
  kind: ContractResource["kind"],
  name: string,
): ContractResource {
  const found = resources.find((item) => item.kind === kind && item.metadata.name === name);
  if (found === undefined) {
    throw new Error(`Missing ${kind}/${name}`);
  }
  return found;
}

function starterBlock(createCommand: string): string {
  const match = createCommand.match(/\n {2}starter:\n(?<starter>[\s\S]*?)(?:\n---|\nYAML)/u);
  if (match?.groups?.starter === undefined) {
    throw new Error("Missing starter block");
  }
  return match.groups.starter;
}
