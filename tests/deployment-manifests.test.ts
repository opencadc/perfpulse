import { describe, expect, test } from "bun:test";
import {
  buildHourlySpotTinySchedule,
  buildManualSpotDirectTinyDeployment,
  renderManifestDocuments,
} from "../src/deployment-manifests";

describe("deployment manifest contracts", () => {
  test("builds the manual M1 spot-direct-tiny TestRun contract", () => {
    const contract = buildManualSpotDirectTinyDeployment({
      imageTag: "2026.05.04",
      otlpCredentialsSecretName: "perfpulse-otlp-credentials",
      skahaSecretName: "perfpulse-skaha-runtime-token",
      testid: "spot-direct-tiny-manual",
    });

    const resources = contract.resources;
    const controlNamespace = resource(resources, "Namespace", "canfar-perfpulse");
    const workloadNamespace = resource(resources, "Namespace", "canfar-workloads");
    const serviceAccount = resource(resources, "ServiceAccount", "perfpulse-runner");
    const role = resource(resources, "Role", "perfpulse-workload-writer");
    const roleBinding = resource(resources, "RoleBinding", "perfpulse-workload-writer");
    const configMap = resource(resources, "ConfigMap", "perfpulse-spot-direct-tiny-config");
    const testRun = resource(resources, "TestRun", "perfpulse-spot-direct-tiny");

    expect(controlNamespace.metadata.namespace).toBeUndefined();
    expect(workloadNamespace.metadata.namespace).toBeUndefined();
    expect(serviceAccount.metadata.namespace).toBe("canfar-perfpulse");
    expect(role.metadata.namespace).toBe("canfar-workloads");
    expect(roleBinding.metadata.namespace).toBe("canfar-workloads");

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
    expect(Object.keys(configMap.data ?? {}).join("\n")).not.toMatch(/TOKEN|PASSWORD|SECRET/u);
    expect(Object.keys(configMap.data ?? {}).join("\n")).not.toMatch(/PROMETHEUS_RW/u);

    expect(testRun.metadata.namespace).toBe("canfar-perfpulse");
    expect(testRun.spec).toMatchObject({
      arguments: "-o opentelemetry",
      parallelism: 1,
      runner: {
        image: "images.opencadc.org/platform/perfpulse:2026.05.04",
        serviceAccountName: "perfpulse-runner",
      },
      script: {
        localFile: "/test/perfpulse.js",
      },
      starter: {
        serviceAccountName: "perfpulse-runner",
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
      value: "spot-direct-tiny-manual",
    });
    expect(testRunSpec.runner.envFrom).toEqual([
      { configMapRef: { name: "perfpulse-spot-direct-tiny-config" } },
      { secretRef: { name: "perfpulse-otlp-credentials", optional: true } },
      { secretRef: { name: "perfpulse-skaha-runtime-token", optional: true } },
    ]);
    expect(renderManifestDocuments(contract)).not.toMatch(
      /experimental-prometheus-rw|K6_PROMETHEUS_RW/u,
    );
  });

  test("builds an hourly non-overlapping spot-tiny CronJob contract", () => {
    const contract = buildHourlySpotTinySchedule({
      imageTag: "2026.05.04",
      kubectlImage: "docker.io/bitnami/kubectl:1.31",
      otlpCredentialsSecretName: "perfpulse-otlp-credentials",
      skahaSecretName: "perfpulse-skaha-runtime-token",
    });

    const resources = contract.resources;
    const cronJob = resource(resources, "CronJob", "perfpulse-spot-tiny-hourly");
    const controlRole = resource(resources, "Role", "perfpulse-testrun-writer");
    const configMap = resource(resources, "ConfigMap", "perfpulse-spot-tiny-config");

    expect(controlRole.metadata.namespace).toBe("canfar-perfpulse");
    expect(controlRole.rules).toContainEqual({
      apiGroups: ["k6.io"],
      resources: ["testruns"],
      verbs: ["create", "delete", "get", "list", "patch"],
    });
    expect(configMap.data).toMatchObject({
      PROFILE: "spot-tiny",
      RUN_CLASS: "spot",
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

    expect(podSpec.serviceAccountName).toBe("perfpulse-runner");
    expect(containers[0]?.image).toBe("docker.io/bitnami/kubectl:1.31");
    expect(createCommand).toContain('TESTID="spot-tiny-$(date -u +%Y%m%d%H%M%S)"');
    expect(createCommand).toContain(`name: perfpulse-spot-tiny-$${"{TESTID}"}`);
    expect(createCommand).toContain("name: perfpulse-spot-tiny-config");
    expect(createCommand).toContain('arguments: "-o opentelemetry"');
    expect(createCommand).toContain(
      "\n      - secretRef:\n          name: perfpulse-otlp-credentials",
    );
    expect(createCommand).toContain("spot-tiny");
    expect(createCommand).not.toMatch(/benchmark|stress/u);
    expect(renderManifestDocuments(contract)).not.toMatch(
      /experimental-prometheus-rw|K6_PROMETHEUS_RW/u,
    );
  });

  test("keeps checked-in YAML examples synchronized with the public contract", async () => {
    const manualYaml = await Bun.file("docs/manifests/perfpulse-m1-spot-direct-tiny.yaml").text();
    const hourlyYaml = await Bun.file("docs/manifests/perfpulse-spot-tiny-hourly.yaml").text();

    expect(manualYaml).toBe(
      renderManifestDocuments(
        buildManualSpotDirectTinyDeployment({
          imageTag: "TAG",
          otlpCredentialsSecretName: "perfpulse-otlp-credentials",
          skahaSecretName: "perfpulse-skaha-runtime-token",
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
          skahaSecretName: "perfpulse-skaha-runtime-token",
        }),
      ),
    );
  });
});

type ContractResource =
  | ReturnType<typeof buildManualSpotDirectTinyDeployment>["resources"][number]
  | ReturnType<typeof buildHourlySpotTinySchedule>["resources"][number];

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
