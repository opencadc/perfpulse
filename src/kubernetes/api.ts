import { sleep } from "k6";
import http, { type RefinedResponse, type ResponseType } from "k6/http";
import type { RunConfig } from "../config";
import { testidSelector } from "../labels";
import type { DirectKubernetesClient } from "./direct";
import type { KubernetesJobManifest } from "./job";
import type { JobListLike } from "./status";

type JsonResponse = RefinedResponse<ResponseType | undefined>;

export interface KubernetesClient extends DirectKubernetesClient {
  createJob(manifest: KubernetesJobManifest): JsonResponse;
  deleteJob(name: string): JsonResponse;
  listJobsByTestId(): JobListLike;
}

export function createKubernetesClient(config: RunConfig, token: string): KubernetesClient {
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const namespace = encodeURIComponent(config.kubernetes.namespace);
  const jobsUrl = `${config.kubernetes.apiServer}/apis/batch/v1/namespaces/${namespace}/jobs`;

  return {
    createJob(manifest: KubernetesJobManifest): JsonResponse {
      return http.post(jobsUrl, JSON.stringify(manifest), {
        headers,
        tags: { name: "k8s_create_job" },
        timeout: "30s",
      });
    },
    deleteJob(name: string): JsonResponse {
      const deleteUrl = `${jobsUrl}/${encodeURIComponent(name)}?propagationPolicy=Background`;
      return http.del(deleteUrl, null, {
        headers,
        tags: { name: "k8s_delete_job" },
        timeout: "30s",
      });
    },
    listJobsByTestId(): JobListLike {
      const selector = encodeURIComponent(testidSelector(config));
      const response = http.get(`${jobsUrl}?labelSelector=${selector}`, {
        headers,
        tags: { name: "k8s_list_jobs" },
        timeout: "30s",
      });
      if (response.status !== 200) {
        throw new Error(
          `Kubernetes list Jobs failed with HTTP ${response.status}: ${response.body}`,
        );
      }
      return JSON.parse(String(response.body ?? "{}")) as JobListLike;
    },
  };
}

export function pollUntil<T>(
  timeoutSeconds: number,
  intervalSeconds: number,
  read: () => T,
  done: (value: T) => boolean,
): T | undefined {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() <= deadline) {
    const value = read();
    if (done(value)) {
      return value;
    }
    sleep(intervalSeconds);
  }
  return undefined;
}
