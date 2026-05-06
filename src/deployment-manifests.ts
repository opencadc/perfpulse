import { DEFAULT_SKAHA_API_URL } from "./config";

const CONTROL_NAMESPACE = "canfar-perfpulse";
const WORKLOAD_NAMESPACE = "canfar-workloads";
const RUNNER_SERVICE_ACCOUNT = "canfar-perfpulse";
const DEFAULT_IMAGE_REPOSITORY = "images.opencadc.org/platform/perfpulse";
const SCRIPT_LOCAL_FILE = "/test/perfpulse.js";
const DEFAULT_SKAHA_CREDENTIALS_SECRET_NAME = "perfpulse-skaha-auth";
const DEFAULT_OTLP_HTTP_EXPORTER_ENDPOINT = "kube-prometheus-stack-prometheus.monitoring:9090";
const DEFAULT_OTLP_HTTP_EXPORTER_URL_PATH = "/api/v1/otlp/v1/metrics";
const RESTRICTED_POD_SECURITY_CONTEXT = {
  runAsGroup: 1000,
  runAsNonRoot: true,
  runAsUser: 1000,
  seccompProfile: {
    type: "RuntimeDefault",
  },
};
const RESTRICTED_CONTAINER_SECURITY_CONTEXT = {
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

export interface DeploymentContract {
  resources: KubernetesResource[];
}

export type KubernetesResource = {
  apiVersion: string;
  data?: Record<string, string>;
  kind: string;
  metadata: {
    labels?: Record<string, string>;
    name: string;
    namespace?: string;
  };
  roleRef?: {
    apiGroup: string;
    kind: string;
    name: string;
  };
  rules?: Array<{
    apiGroups: string[];
    resources: string[];
    verbs: string[];
  }>;
  spec?: Record<string, unknown>;
  subjects?: Array<{
    kind: string;
    name: string;
    namespace: string;
  }>;
};

export interface ManualSpotDirectTinyOptions {
  imageTag: string;
  otlpCredentialsSecretName?: string;
  otlpHttpExporterEndpoint?: string;
  otlpHttpExporterUrlPath?: string;
  testid: string;
}

export interface ManualSpotKueueTinyOptions {
  imageTag: string;
  otlpCredentialsSecretName?: string;
  otlpHttpExporterEndpoint?: string;
  otlpHttpExporterUrlPath?: string;
  testid: string;
}

export interface ManualBenchmarkSmallDirectKueueOptions {
  imageTag: string;
  otlpCredentialsSecretName?: string;
  otlpHttpExporterEndpoint?: string;
  otlpHttpExporterUrlPath?: string;
  skahaApiUrl?: string;
  skahaCredentialsSecretName?: string;
  testid: string;
}

export interface ManualSpotSkahaTinyOptions {
  imageTag: string;
  otlpCredentialsSecretName?: string;
  otlpHttpExporterEndpoint?: string;
  otlpHttpExporterUrlPath?: string;
  skahaApiUrl?: string;
  skahaCredentialsSecretName?: string;
  testid: string;
}

export { DEFAULT_SKAHA_API_URL };

export interface HourlySpotTinyScheduleOptions {
  imageTag: string;
  kubectlImage?: string;
  otlpCredentialsSecretName?: string;
  otlpHttpExporterEndpoint?: string;
  otlpHttpExporterUrlPath?: string;
}

export function buildManualSpotDirectTinyDeployment(
  options: ManualSpotDirectTinyOptions,
): DeploymentContract {
  const configMapName = "perfpulse-spot-direct-tiny-config";
  const labels = contractLabels("spot-direct-tiny");

  return {
    resources: [
      namespace(CONTROL_NAMESPACE),
      namespace(WORKLOAD_NAMESPACE),
      serviceAccount(labels),
      workloadRole(labels, false),
      workloadRoleBinding(labels),
      {
        apiVersion: "v1",
        data: {
          CLEANUP: "true",
          COMPLETION_GATE_SECONDS: "120",
          ...otlpConfig(options),
          PERF_PULSE_CLIENT_MODE: "kubernetes",
          PROFILE: "spot-direct-tiny",
          RUN_CLASS: "spot",
          SURFACE: "k8s-direct",
          VISIBILITY_GATE_SECONDS: "60",
          WORKLOAD_NAMESPACE,
        },
        kind: "ConfigMap",
        metadata: {
          labels,
          name: configMapName,
          namespace: CONTROL_NAMESPACE,
        },
      },
      testRun({
        arguments: "-o opentelemetry",
        configMapName,
        image: `${DEFAULT_IMAGE_REPOSITORY}:${options.imageTag}`,
        labels,
        name: "perfpulse-spot-direct-tiny",
        profile: "spot-direct-tiny",
        secretNames: [options.otlpCredentialsSecretName],
        testid: options.testid,
      }),
    ],
  };
}

export function buildManualSpotKueueTinyDeployment(
  options: ManualSpotKueueTinyOptions,
): DeploymentContract {
  const configMapName = "perfpulse-spot-kueue-tiny-config";
  const labels = contractLabels("spot-tiny");

  return {
    resources: [
      namespace(CONTROL_NAMESPACE),
      namespace(WORKLOAD_NAMESPACE),
      serviceAccount(labels),
      workloadRole(labels, true),
      workloadRoleBinding(labels),
      {
        apiVersion: "v1",
        data: {
          CLEANUP: "true",
          COMPLETION_GATE_SECONDS: "120",
          KUEUE_ADMISSION_GATE_SECONDS: "120",
          KUEUE_PRIORITY_CLASS: "low",
          KUEUE_QUEUE_NAME: "cadc-default",
          ...otlpConfig(options),
          K6_OTEL_EXPORT_INTERVAL: "1s",
          PERF_PULSE_CLIENT_MODE: "kubernetes",
          PROFILE: "spot-tiny",
          RUN_CLASS: "spot",
          SURFACE: "k8s-kueue",
          VISIBILITY_GATE_SECONDS: "60",
          WORKLOAD_NAMESPACE,
        },
        kind: "ConfigMap",
        metadata: {
          labels,
          name: configMapName,
          namespace: CONTROL_NAMESPACE,
        },
      },
      testRun({
        arguments: "-o opentelemetry",
        configMapName,
        image: `${DEFAULT_IMAGE_REPOSITORY}:${options.imageTag}`,
        labels,
        name: "perfpulse-spot-kueue-tiny",
        profile: "spot-tiny",
        secretNames: [options.otlpCredentialsSecretName],
        testid: options.testid,
      }),
    ],
  };
}

export function buildManualBenchmarkSmallDirectKueueDeployment(
  options: ManualBenchmarkSmallDirectKueueOptions,
): DeploymentContract {
  const directConfigMapName = "perfpulse-benchmark-small-direct-config";
  const kueueConfigMapName = "perfpulse-benchmark-small-kueue-config";
  const skahaConfigMapName = "perfpulse-benchmark-small-skaha-config";
  const labels = contractLabels("benchmark-small");
  const skahaCredentialsSecretName =
    options.skahaCredentialsSecretName ?? DEFAULT_SKAHA_CREDENTIALS_SECRET_NAME;

  return {
    resources: [
      namespace(CONTROL_NAMESPACE),
      namespace(WORKLOAD_NAMESPACE),
      serviceAccount(labels),
      workloadRole(labels, true),
      workloadRoleBinding(labels),
      {
        apiVersion: "v1",
        data: {
          CLEANUP: "true",
          COMPLETION_GATE_SECONDS: "300",
          ...otlpConfig(options, "perfpulse-benchmark-small-direct"),
          K6_OTEL_EXPORT_INTERVAL: "1s",
          LOGICAL_USERS: "100",
          PERF_PULSE_CLIENT_MODE: "kubernetes",
          PROFILE: "benchmark-small",
          RUN_CLASS: "benchmark",
          SCENARIO: "many-small-users",
          SURFACE: "k8s-direct",
          TOTAL_JOBS: "100",
          VISIBILITY_GATE_SECONDS: "120",
          WORKLOAD_NAMESPACE,
        },
        kind: "ConfigMap",
        metadata: {
          labels,
          name: directConfigMapName,
          namespace: CONTROL_NAMESPACE,
        },
      },
      {
        apiVersion: "v1",
        data: {
          CLEANUP: "true",
          COMPLETION_GATE_SECONDS: "300",
          KUEUE_ADMISSION_GATE_SECONDS: "300",
          KUEUE_PRIORITY_CLASS: "low",
          KUEUE_QUEUE_NAME: "cadc-default",
          ...otlpConfig(options, "perfpulse-benchmark-small-kueue"),
          K6_OTEL_EXPORT_INTERVAL: "1s",
          LOGICAL_USERS: "100",
          PERF_PULSE_CLIENT_MODE: "kubernetes",
          PROFILE: "benchmark-small",
          RUN_CLASS: "benchmark",
          SCENARIO: "many-small-users",
          SURFACE: "k8s-kueue",
          TOTAL_JOBS: "100",
          VISIBILITY_GATE_SECONDS: "120",
          WORKLOAD_NAMESPACE,
        },
        kind: "ConfigMap",
        metadata: {
          labels,
          name: kueueConfigMapName,
          namespace: CONTROL_NAMESPACE,
        },
      },
      {
        apiVersion: "v1",
        data: {
          CLEANUP: "true",
          COMPLETION_GATE_SECONDS: "300",
          ...otlpConfig(options, "perfpulse-benchmark-small-skaha"),
          K6_OTEL_EXPORT_INTERVAL: "1s",
          LOGICAL_USERS: "100",
          PERF_PULSE_CLIENT_MODE: "kubernetes",
          PROFILE: "benchmark-small",
          RUN_CLASS: "benchmark",
          SCENARIO: "many-small-users",
          SKAHA_API_URL: options.skahaApiUrl ?? DEFAULT_SKAHA_API_URL,
          SKAHA_LOGIN_URL: "https://ws-cadc.canfar.net/ac/login",
          SKAHA_PASSWORD_PATH: "/var/run/secrets/perfpulse/skaha-auth/password",
          SKAHA_REQUEST_TIMEOUT_SECONDS: "120",
          SKAHA_USERNAME_PATH: "/var/run/secrets/perfpulse/skaha-auth/username",
          SUBMISSION_STAGGER_SECONDS: "1",
          SURFACE: "skaha",
          TOTAL_JOBS: "100",
          VISIBILITY_GATE_SECONDS: "120",
        },
        kind: "ConfigMap",
        metadata: {
          labels,
          name: skahaConfigMapName,
          namespace: CONTROL_NAMESPACE,
        },
      },
      testRun({
        arguments: "-o opentelemetry",
        configMapName: directConfigMapName,
        image: `${DEFAULT_IMAGE_REPOSITORY}:${options.imageTag}`,
        labels,
        name: "perfpulse-benchmark-small-direct",
        profile: "benchmark-small",
        secretNames: [options.otlpCredentialsSecretName],
        testid: options.testid,
      }),
      testRun({
        arguments: "-o opentelemetry",
        configMapName: kueueConfigMapName,
        image: `${DEFAULT_IMAGE_REPOSITORY}:${options.imageTag}`,
        labels,
        name: "perfpulse-benchmark-small-kueue",
        profile: "benchmark-small",
        secretNames: [options.otlpCredentialsSecretName],
        testid: options.testid,
      }),
      testRun({
        arguments: "-o opentelemetry",
        configMapName: skahaConfigMapName,
        image: `${DEFAULT_IMAGE_REPOSITORY}:${options.imageTag}`,
        labels,
        name: "perfpulse-benchmark-small-skaha",
        profile: "benchmark-small",
        secretNames: [options.otlpCredentialsSecretName],
        skahaCredentialsSecretName,
        testid: options.testid,
      }),
    ],
  };
}

export function buildManualSpotSkahaTinyDeployment(
  options: ManualSpotSkahaTinyOptions,
): DeploymentContract {
  const configMapName = "perfpulse-spot-skaha-tiny-config";
  const labels = contractLabels("spot-tiny");
  const skahaCredentialsSecretName =
    options.skahaCredentialsSecretName ?? DEFAULT_SKAHA_CREDENTIALS_SECRET_NAME;

  return {
    resources: [
      namespace(CONTROL_NAMESPACE),
      serviceAccount(labels),
      {
        apiVersion: "v1",
        data: {
          CLEANUP: "true",
          COMPLETION_GATE_SECONDS: "120",
          ...otlpConfig(options),
          K6_OTEL_EXPORT_INTERVAL: "1s",
          PERF_PULSE_CLIENT_MODE: "kubernetes",
          PROFILE: "spot-tiny",
          RUN_CLASS: "spot",
          SKAHA_API_URL: options.skahaApiUrl ?? DEFAULT_SKAHA_API_URL,
          SKAHA_LOGIN_URL: "https://ws-cadc.canfar.net/ac/login",
          SKAHA_PASSWORD_PATH: "/var/run/secrets/perfpulse/skaha-auth/password",
          SKAHA_USERNAME_PATH: "/var/run/secrets/perfpulse/skaha-auth/username",
          SURFACE: "skaha",
          VISIBILITY_GATE_SECONDS: "60",
        },
        kind: "ConfigMap",
        metadata: {
          labels,
          name: configMapName,
          namespace: CONTROL_NAMESPACE,
        },
      },
      testRun({
        arguments: "-o opentelemetry",
        configMapName,
        image: `${DEFAULT_IMAGE_REPOSITORY}:${options.imageTag}`,
        labels,
        name: "perfpulse-spot-skaha-tiny",
        profile: "spot-tiny",
        secretNames: [options.otlpCredentialsSecretName],
        skahaCredentialsSecretName,
        testid: options.testid,
      }),
    ],
  };
}

export function buildHourlySpotTinySchedule(
  options: HourlySpotTinyScheduleOptions,
): DeploymentContract {
  const configMapName = "perfpulse-spot-tiny-config";
  const labels = contractLabels("spot-tiny");
  const image = `${DEFAULT_IMAGE_REPOSITORY}:${options.imageTag}`;
  const secretRefs = [options.otlpCredentialsSecretName]
    .filter((name): name is string => name !== undefined)
    .map((name) => `      - secretRef:\n          name: ${name}\n          optional: true`)
    .join("\n");

  return {
    resources: [
      namespace(CONTROL_NAMESPACE),
      namespace(WORKLOAD_NAMESPACE),
      serviceAccount(labels),
      workloadRole(labels, false),
      workloadRoleBinding(labels),
      testRunWriterRole(labels),
      testRunWriterRoleBinding(labels),
      {
        apiVersion: "v1",
        data: {
          CLEANUP: "true",
          COMPLETION_GATE_SECONDS: "120",
          ...otlpConfig(options),
          PERF_PULSE_CLIENT_MODE: "kubernetes",
          PROFILE: "spot-tiny",
          RUN_CLASS: "spot",
          VISIBILITY_GATE_SECONDS: "60",
          WORKLOAD_NAMESPACE,
        },
        kind: "ConfigMap",
        metadata: {
          labels,
          name: configMapName,
          namespace: CONTROL_NAMESPACE,
        },
      },
      {
        apiVersion: "batch/v1",
        kind: "CronJob",
        metadata: {
          labels,
          name: "perfpulse-spot-tiny-hourly",
          namespace: CONTROL_NAMESPACE,
        },
        spec: {
          concurrencyPolicy: "Forbid",
          failedJobsHistoryLimit: 3,
          jobTemplate: {
            spec: {
              activeDeadlineSeconds: 300,
              backoffLimit: 0,
              template: {
                metadata: {
                  labels,
                },
                spec: {
                  containers: [
                    {
                      args: [
                        scheduledTestRunApplyCommand({
                          configMapName,
                          image,
                          secretRefs,
                        }),
                      ],
                      command: ["/bin/sh", "-c"],
                      image: options.kubectlImage ?? "docker.io/bitnami/kubectl:1.31",
                      name: "create-testrun",
                      securityContext: RESTRICTED_CONTAINER_SECURITY_CONTEXT,
                    },
                  ],
                  restartPolicy: "Never",
                  securityContext: RESTRICTED_POD_SECURITY_CONTEXT,
                  serviceAccountName: RUNNER_SERVICE_ACCOUNT,
                },
              },
              ttlSecondsAfterFinished: 900,
            },
          },
          schedule: "0 * * * *",
          successfulJobsHistoryLimit: 1,
        },
      },
    ],
  };
}

export function renderManifestDocuments(contract: DeploymentContract): string {
  return `${contract.resources.map((resource) => renderYaml(resource, 0).trimEnd()).join("\n---\n")}\n`;
}

function namespace(name: string): KubernetesResource {
  return {
    apiVersion: "v1",
    kind: "Namespace",
    metadata: {
      name,
    },
  };
}

function serviceAccount(labels: Record<string, string>): KubernetesResource {
  return {
    apiVersion: "v1",
    kind: "ServiceAccount",
    metadata: {
      labels,
      name: RUNNER_SERVICE_ACCOUNT,
      namespace: CONTROL_NAMESPACE,
    },
  };
}

function workloadRole(
  labels: Record<string, string>,
  includeKueueWorkloads: boolean,
): KubernetesResource {
  const rules: NonNullable<KubernetesResource["rules"]> = [
    {
      apiGroups: ["batch"],
      resources: ["jobs"],
      verbs: ["create", "delete", "get", "list"],
    },
  ];
  if (includeKueueWorkloads) {
    rules.push({
      apiGroups: ["kueue.x-k8s.io"],
      resources: ["workloads"],
      verbs: ["get", "list"],
    });
  }

  return {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "Role",
    metadata: {
      labels,
      name: "perfpulse-workload-writer",
      namespace: WORKLOAD_NAMESPACE,
    },
    rules,
  };
}

function workloadRoleBinding(labels: Record<string, string>): KubernetesResource {
  return {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "RoleBinding",
    metadata: {
      labels,
      name: "perfpulse-workload-writer",
      namespace: WORKLOAD_NAMESPACE,
    },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "Role",
      name: "perfpulse-workload-writer",
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: RUNNER_SERVICE_ACCOUNT,
        namespace: CONTROL_NAMESPACE,
      },
    ],
  };
}

function testRunWriterRole(labels: Record<string, string>): KubernetesResource {
  return {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "Role",
    metadata: {
      labels,
      name: "perfpulse-testrun-writer",
      namespace: CONTROL_NAMESPACE,
    },
    rules: [
      {
        apiGroups: ["k6.io"],
        resources: ["testruns"],
        verbs: ["create", "delete", "get", "list", "patch"],
      },
    ],
  };
}

function testRunWriterRoleBinding(labels: Record<string, string>): KubernetesResource {
  return {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "RoleBinding",
    metadata: {
      labels,
      name: "perfpulse-testrun-writer",
      namespace: CONTROL_NAMESPACE,
    },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "Role",
      name: "perfpulse-testrun-writer",
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: RUNNER_SERVICE_ACCOUNT,
        namespace: CONTROL_NAMESPACE,
      },
    ],
  };
}

function testRun(options: {
  arguments: string;
  configMapName: string;
  image: string;
  labels: Record<string, string>;
  name: string;
  profile: string;
  secretNames: Array<string | undefined>;
  skahaCredentialsSecretName?: string;
  testid: string;
}): KubernetesResource {
  const skahaAuthVolumeName = "skaha-auth-credentials";
  return {
    apiVersion: "k6.io/v1alpha1",
    kind: "TestRun",
    metadata: {
      labels: options.labels,
      name: options.name,
      namespace: CONTROL_NAMESPACE,
    },
    spec: {
      arguments: options.arguments,
      initializer: {
        containerSecurityContext: RESTRICTED_CONTAINER_SECURITY_CONTEXT,
        image: options.image,
        securityContext: RESTRICTED_POD_SECURITY_CONTEXT,
        serviceAccountName: RUNNER_SERVICE_ACCOUNT,
      },
      parallelism: 1,
      runner: {
        containerSecurityContext: RESTRICTED_CONTAINER_SECURITY_CONTEXT,
        env: [
          {
            name: "TESTID",
            value: options.testid,
          },
        ],
        envFrom: [
          {
            configMapRef: {
              name: options.configMapName,
            },
          },
          ...options.secretNames
            .filter((name): name is string => name !== undefined)
            .map((name) => ({
              secretRef: {
                name,
                optional: true,
              },
            })),
        ],
        image: options.image,
        securityContext: RESTRICTED_POD_SECURITY_CONTEXT,
        serviceAccountName: RUNNER_SERVICE_ACCOUNT,
        volumeMounts:
          options.skahaCredentialsSecretName === undefined
            ? undefined
            : [
                {
                  mountPath: "/var/run/secrets/perfpulse/skaha-auth",
                  name: skahaAuthVolumeName,
                  readOnly: true,
                },
              ],
        volumes:
          options.skahaCredentialsSecretName === undefined
            ? undefined
            : [
                {
                  name: skahaAuthVolumeName,
                  secret: {
                    secretName: options.skahaCredentialsSecretName,
                  },
                },
              ],
      },
      script: {
        localFile: SCRIPT_LOCAL_FILE,
      },
      starter: {
        containerSecurityContext: RESTRICTED_CONTAINER_SECURITY_CONTEXT,
        securityContext: RESTRICTED_POD_SECURITY_CONTEXT,
        serviceAccountName: RUNNER_SERVICE_ACCOUNT,
      },
    },
  };
}

function contractLabels(profile: string): Record<string, string> {
  return {
    "app.kubernetes.io/name": "perfpulse",
    "app.kubernetes.io/part-of": "perfpulse",
    "perfpulse.opencadc.org/profile": profile,
  };
}

function otlpConfig(
  options: {
    otlpHttpExporterEndpoint?: string;
    otlpHttpExporterUrlPath?: string;
  },
  serviceName = "perfpulse",
): Record<string, string> {
  return {
    K6_OTEL_EXPORTER_PROTOCOL: "http/protobuf",
    K6_OTEL_HTTP_EXPORTER_INSECURE: "true",
    K6_OTEL_HTTP_EXPORTER_ENDPOINT:
      options.otlpHttpExporterEndpoint ?? DEFAULT_OTLP_HTTP_EXPORTER_ENDPOINT,
    K6_OTEL_HTTP_EXPORTER_URL_PATH:
      options.otlpHttpExporterUrlPath ?? DEFAULT_OTLP_HTTP_EXPORTER_URL_PATH,
    K6_OTEL_METRIC_PREFIX: "k6_",
    K6_OTEL_SERVICE_NAME: serviceName,
    K6_OTEL_EXPORT_INTERVAL: "5s",
  };
}

function renderYaml(value: unknown, indent: number): string {
  if (Array.isArray(value)) {
    return renderArray(value, indent);
  }
  if (isPlainObject(value)) {
    return renderObject(value, indent);
  }
  return `${" ".repeat(indent)}${formatScalar(value)}\n`;
}

function renderObject(value: Record<string, unknown>, indent: number): string {
  const lines: string[] = [];

  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) {
      continue;
    }
    const padding = " ".repeat(indent);
    if (isScalar(item)) {
      lines.push(`${padding}${key}: ${formatScalar(item)}`);
      continue;
    }
    if (typeof item === "string" && item.includes("\n")) {
      lines.push(`${padding}${key}: |-`);
      lines.push(...blockLines(item, indent + 2));
      continue;
    }
    lines.push(`${padding}${key}:`);
    lines.push(renderYaml(item, indent + 2).replace(/\n$/u, ""));
  }

  return `${lines.join("\n")}\n`;
}

function renderArray(value: unknown[], indent: number): string {
  const lines: string[] = [];
  const padding = " ".repeat(indent);

  for (const item of value) {
    if (typeof item === "string" && item.includes("\n")) {
      lines.push(`${padding}- |-`);
      lines.push(...blockLines(item, indent + 2));
      continue;
    }
    if (isScalar(item)) {
      lines.push(`${padding}- ${formatScalar(item)}`);
      continue;
    }
    lines.push(`${padding}-`);
    lines.push(renderYaml(item, indent + 2).replace(/\n$/u, ""));
  }

  return `${lines.join("\n")}\n`;
}

function blockLines(value: string, indent: number): string[] {
  const padding = " ".repeat(indent);
  return value.split("\n").map((line) => `${padding}${line}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is boolean | number | string | null {
  return (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    (typeof value === "string" && !value.includes("\n"))
  );
}

function formatScalar(value: unknown): string {
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  if (value === null) {
    return "null";
  }
  if (typeof value !== "string") {
    throw new Error(`Cannot render non-scalar YAML value: ${typeof value}`);
  }
  if (value === "") {
    return '""';
  }
  if (needsQuoting(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function needsQuoting(value: string): boolean {
  return (
    value !== value.trim() ||
    /^[*#[\]{},&!|>'"%@`-]/u.test(value) ||
    value.includes("*") ||
    /^(true|false|null|[-+]?\d+(\.\d+)?)$/iu.test(value) ||
    /:\s/u.test(value) ||
    /\s#/u.test(value)
  );
}

function scheduledTestRunApplyCommand(options: {
  configMapName: string;
  image: string;
  secretRefs: string;
}): string {
  const secretRefs = options.secretRefs.length > 0 ? `\n${options.secretRefs}` : "";

  return `set -eu
TESTID="spot-tiny-$(date -u +%Y%m%d%H%M%S)"
cat <<YAML | kubectl apply -f -
apiVersion: k6.io/v1alpha1
kind: TestRun
metadata:
  name: perfpulse-spot-tiny-\${TESTID}
  namespace: ${CONTROL_NAMESPACE}
  labels:
    app.kubernetes.io/name: perfpulse
    app.kubernetes.io/part-of: perfpulse
    perfpulse.opencadc.org/profile: spot-tiny
    perfpulse.opencadc.org/testid: \${TESTID}
spec:
  cleanup: post
  parallelism: 1
  arguments: "-o opentelemetry"
  script:
    localFile: ${SCRIPT_LOCAL_FILE}
  initializer:
    image: ${options.image}
    serviceAccountName: ${RUNNER_SERVICE_ACCOUNT}
    securityContext:
      runAsGroup: 1000
      runAsNonRoot: true
      runAsUser: 1000
      seccompProfile:
        type: RuntimeDefault
    containerSecurityContext:
      allowPrivilegeEscalation: false
      capabilities:
        drop:
          - ALL
      runAsGroup: 1000
      runAsNonRoot: true
      runAsUser: 1000
      seccompProfile:
        type: RuntimeDefault
  runner:
    image: ${options.image}
    serviceAccountName: ${RUNNER_SERVICE_ACCOUNT}
    securityContext:
      runAsGroup: 1000
      runAsNonRoot: true
      runAsUser: 1000
      seccompProfile:
        type: RuntimeDefault
    containerSecurityContext:
      allowPrivilegeEscalation: false
      capabilities:
        drop:
          - ALL
      runAsGroup: 1000
      runAsNonRoot: true
      runAsUser: 1000
      seccompProfile:
        type: RuntimeDefault
    env:
      - name: TESTID
        value: \${TESTID}
    envFrom:
      - configMapRef:
          name: ${options.configMapName}${secretRefs}
  starter:
    serviceAccountName: ${RUNNER_SERVICE_ACCOUNT}
    securityContext:
      runAsGroup: 1000
      runAsNonRoot: true
      runAsUser: 1000
      seccompProfile:
        type: RuntimeDefault
    containerSecurityContext:
      allowPrivilegeEscalation: false
      capabilities:
        drop:
          - ALL
      runAsGroup: 1000
      runAsNonRoot: true
      runAsUser: 1000
      seccompProfile:
        type: RuntimeDefault
YAML`;
}
