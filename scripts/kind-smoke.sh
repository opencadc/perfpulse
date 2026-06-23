#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-perfpulse}"
CONTROL_NAMESPACE="${CONTROL_NAMESPACE:-canfar-perfpulse}"
WORKLOAD_NAMESPACE="${WORKLOAD_NAMESPACE:-canfar-workloads}"
IMAGE="${IMAGE:-perfpulse:kind-smoke}"
RUNNER_JOB_NAME="${RUNNER_JOB_NAME:-perfpulse-kind-smoke}"
TESTID="${TESTID:-kind-smoke-$(date -u +%Y%m%d%H%M%S)}"
ARTIFACT_DIR="${ARTIFACT_DIR:-artifacts/kind-smoke/${TESTID}}"
K6_WEB_DASHBOARD_FORWARD="${K6_WEB_DASHBOARD_FORWARD:-false}"
K6_WEB_DASHBOARD_PORT="${K6_WEB_DASHBOARD_PORT:-5665}"
LABEL_APP_NAME="app.kubernetes.io/name"
LABEL_TESTID="perfpulse.opencadc.org/testid"
TESTID_SELECTOR="${LABEL_TESTID}=${TESTID}"

tmp_dir=""
port_forward_pid=""

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

cleanup() {
  if [[ -n "${port_forward_pid}" ]]; then
    kill "${port_forward_pid}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${tmp_dir}" ]]; then
    rm -rf "${tmp_dir}"
  fi
}
trap cleanup EXIT

require_command bun
require_command docker
require_command kind
require_command k6
require_command kubectl

mkdir -p "${ARTIFACT_DIR}"
tmp_dir="$(mktemp -d)"

if ! kind get clusters | grep -qx "${CLUSTER_NAME}"; then
  echo "Kind cluster '${CLUSTER_NAME}' is not available; create it before running the smoke." >&2
  exit 1
fi
kubectl config use-context "kind-${CLUSTER_NAME}"

bun run build
docker build -t "${IMAGE}" .
kind load docker-image "${IMAGE}" --name "${CLUSTER_NAME}"

cat >"${tmp_dir}/namespaces.yaml" <<YAML
apiVersion: v1
kind: Namespace
metadata:
  name: ${CONTROL_NAMESPACE}
---
apiVersion: v1
kind: Namespace
metadata:
  name: ${WORKLOAD_NAMESPACE}
YAML

cat >"${tmp_dir}/rbac.yaml" <<YAML
apiVersion: v1
kind: ServiceAccount
metadata:
  name: canfar-perfpulse
  namespace: ${CONTROL_NAMESPACE}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: perfpulse-workload-writer
  namespace: ${WORKLOAD_NAMESPACE}
rules:
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["create", "delete", "get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: perfpulse-workload-writer
  namespace: ${WORKLOAD_NAMESPACE}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: perfpulse-workload-writer
subjects:
  - kind: ServiceAccount
    name: canfar-perfpulse
    namespace: ${CONTROL_NAMESPACE}
YAML

cat >"${tmp_dir}/runner-job.yaml" <<YAML
apiVersion: batch/v1
kind: Job
metadata:
  name: ${RUNNER_JOB_NAME}
  namespace: ${CONTROL_NAMESPACE}
  labels:
    ${LABEL_APP_NAME}: perfpulse
    ${LABEL_TESTID}: ${TESTID}
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 300
  template:
    metadata:
      labels:
        ${LABEL_APP_NAME}: perfpulse
        ${LABEL_TESTID}: ${TESTID}
    spec:
      serviceAccountName: canfar-perfpulse
      restartPolicy: Never
      containers:
        - name: k6
          image: ${IMAGE}
          imagePullPolicy: IfNotPresent
          args: ["run", "/test/perfpulse.js"]
          env:
            - name: PERF_PULSE_CLIENT_MODE
              value: kubernetes
            - name: RUN_CLASS
              value: cron
            - name: TESTID
              value: ${TESTID}
            - name: WORKLOAD_NAMESPACE
              value: ${WORKLOAD_NAMESPACE}
            - name: WORKLOAD_IMAGE
              value: ${IMAGE}
            - name: WORKLOAD_COMMAND
              value: '["stress-ng"]'
            - name: K8S_INSECURE_SKIP_TLS_VERIFY
              value: "true"
            - name: K6_WEB_DASHBOARD
              value: "true"
            - name: K6_WEB_DASHBOARD_PERIOD
              value: 1s
YAML

kubectl apply -f "${tmp_dir}/namespaces.yaml"
kubectl apply -f "${tmp_dir}/rbac.yaml"
kubectl delete job "${RUNNER_JOB_NAME}" -n "${CONTROL_NAMESPACE}" --ignore-not-found
kubectl apply -f "${tmp_dir}/runner-job.yaml"

runner_pod=""
for _ in $(seq 1 120); do
  runner_pod="$(kubectl get pods -n "${CONTROL_NAMESPACE}" \
    -l "${TESTID_SELECTOR}" \
    -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null \
    | head -n 1 || true)"
  if [[ -n "${runner_pod}" ]]; then
    break
  fi
  sleep 1
done

if [[ -z "${runner_pod}" ]]; then
  kubectl describe job "${RUNNER_JOB_NAME}" -n "${CONTROL_NAMESPACE}" >"${ARTIFACT_DIR}/runner-job.describe.txt" || true
  echo "Timed out waiting for a k6 runner pod" >&2
  exit 1
fi

if [[ "${K6_WEB_DASHBOARD_FORWARD}" == "true" ]]; then
  kubectl wait pod "${runner_pod}" -n "${CONTROL_NAMESPACE}" --for=condition=Ready --timeout=60s || true
  kubectl port-forward -n "${CONTROL_NAMESPACE}" "pod/${runner_pod}" \
    "${K6_WEB_DASHBOARD_PORT}:5665" >"${ARTIFACT_DIR}/web-dashboard-port-forward.log" 2>&1 &
  port_forward_pid="$!"
  echo "Forwarding k6 web dashboard at http://127.0.0.1:${K6_WEB_DASHBOARD_PORT}"
fi

if ! kubectl wait pod "${runner_pod}" -n "${CONTROL_NAMESPACE}" \
  --for=jsonpath='{.status.phase}'=Succeeded \
  --timeout=300s; then
  kubectl logs -n "${CONTROL_NAMESPACE}" "${runner_pod}" >"${ARTIFACT_DIR}/runner.log" || true
  kubectl describe pod "${runner_pod}" -n "${CONTROL_NAMESPACE}" >"${ARTIFACT_DIR}/runner.describe.txt" || true
  kubectl describe job "${RUNNER_JOB_NAME}" -n "${CONTROL_NAMESPACE}" >"${ARTIFACT_DIR}/runner-job.describe.txt" || true
  echo "k6 runner did not complete successfully; see ${ARTIFACT_DIR}" >&2
  exit 1
fi

kubectl logs -n "${CONTROL_NAMESPACE}" "${runner_pod}" >"${ARTIFACT_DIR}/runner.log"
kubectl describe job "${RUNNER_JOB_NAME}" -n "${CONTROL_NAMESPACE}" >"${ARTIFACT_DIR}/runner-job.describe.txt"
kubectl get jobs -n "${WORKLOAD_NAMESPACE}" \
  -l "${TESTID_SELECTOR}" \
  -o yaml >"${ARTIFACT_DIR}/workload-jobs.after.yaml"

if kubectl get jobs -n "${WORKLOAD_NAMESPACE}" \
  -l "${TESTID_SELECTOR}" \
  --no-headers 2>/dev/null | grep -q .; then
  echo "Workload Job still exists after k6 teardown; see ${ARTIFACT_DIR}/workload-jobs.after.yaml" >&2
  exit 1
fi

kubectl delete job "${RUNNER_JOB_NAME}" -n "${CONTROL_NAMESPACE}" --ignore-not-found

PERF_PULSE_CLIENT_MODE=noop \
  TESTID="${TESTID}" \
  NOOP_SLEEP_SECONDS=10 \
  K6_WEB_DASHBOARD=true \
  K6_WEB_DASHBOARD_PERIOD=1s \
  K6_WEB_DASHBOARD_EXPORT="${ARTIFACT_DIR}/k6-web-dashboard.html" \
  k6 run dist/perfpulse.js >"${ARTIFACT_DIR}/web-dashboard-export.log" 2>&1

if [[ ! -s "${ARTIFACT_DIR}/k6-web-dashboard.html" ]]; then
  echo "k6 web dashboard export was not generated" >&2
  exit 1
fi

echo "M0.5 kind smoke passed"
echo "Artifacts: ${ARTIFACT_DIR}"
