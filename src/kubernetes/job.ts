import type { RunConfig } from "../config";
import { workloadLabels } from "../labels";

export interface KubernetesJobManifest {
  apiVersion: "batch/v1";
  kind: "Job";
  metadata: {
    labels: Record<string, string>;
    name: string;
    namespace: string;
  };
  spec: {
    activeDeadlineSeconds: number;
    backoffLimit: 0;
    template: {
      metadata: {
        labels: Record<string, string>;
      };
      spec: {
        containers: Array<{
          args: string[];
          command?: string[];
          image: string;
          imagePullPolicy: RunConfig["workload"]["imagePullPolicy"];
          name: "workload";
          resources: {
            limits: Record<string, string>;
            requests: Record<string, string>;
          };
        }>;
        restartPolicy: "Never";
      };
    };
    ttlSecondsAfterFinished: number;
  };
}

export function buildDirectJobManifest(config: RunConfig): KubernetesJobManifest {
  const labels = workloadLabels(config);
  const container: KubernetesJobManifest["spec"]["template"]["spec"]["containers"][number] = {
    args: config.workload.args,
    image: config.workload.image,
    imagePullPolicy: config.workload.imagePullPolicy,
    name: "workload",
    resources: {
      limits: {
        cpu: "100m",
        "ephemeral-storage": "1Gi",
        memory: "256Mi",
      },
      requests: {
        cpu: "100m",
        "ephemeral-storage": "1Gi",
        memory: "256Mi",
      },
    },
  };
  if (config.workload.command !== undefined) {
    container.command = config.workload.command;
  }

  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      labels,
      name: config.jobName,
      namespace: config.kubernetes.namespace,
    },
    spec: {
      activeDeadlineSeconds: config.workload.activeDeadlineSeconds,
      backoffLimit: 0,
      template: {
        metadata: {
          labels,
        },
        spec: {
          containers: [container],
          restartPolicy: "Never",
        },
      },
      ttlSecondsAfterFinished: config.workload.ttlSecondsAfterFinished,
    },
  };
}
