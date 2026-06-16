#!/usr/bin/env bash
# Single Skaha headless session: login, create (60s stress-ng), poll, delete.
# Local bash only — no cluster debug pods. See docs/runbooks/skaha-debug.md.
set -euo pipefail

BASE="${SKAHA_API_URL:-https://staging.canfar.net/skaha/v1}"
LOGIN_URL="${SKAHA_LOGIN_URL:-https://ws-cadc.canfar.net/ac/login}"
NS="${SKAHA_SECRET_NAMESPACE:-canfar-perfpulse}"
SECRET="${SKAHA_SECRET_NAME:-perfpulse-skaha-auth}"
POLL_MAX="${SKAHA_POLL_MAX_SECONDS:-180}"
POLL_INTERVAL="${SKAHA_POLL_INTERVAL_SECONDS:-5}"

USER=$(kubectl get secret "${SECRET}" -n "${NS}" -o jsonpath='{.data.username}' | base64 -d)
PASS=$(kubectl get secret "${SECRET}" -n "${NS}" -o jsonpath='{.data.password}' | base64 -d)
REGISTRY_AUTH=$(printf '%s' "${USER}:${PASS}" | base64)

TOKEN=$(curl -sS -X POST "${LOGIN_URL}" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "username=${USER}" --data-urlencode "password=${PASS}")

NAME="debug-manual-$(date -u +%Y%m%d%H%M%S)"
QUERY="name=${NAME}&image=images.canfar.net%2Fskaha%2Fstress-ng%3Alatest&type=headless&cores=1&ram=1&cmd=stress-ng&args=--cpu+1+--temp-path+%2Ftmp+--timeout+60s+--metrics-brief&env=PERF_PULSE_TESTID%3D${NAME}"

echo "Login user: ${USER}"
HTTP=$(curl -sS -o /tmp/skaha-create.txt -w '%{http_code}' -X POST "${BASE}/session?${QUERY}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'X-Skaha-Authentication-Type: RUNTIME-TOKEN' \
  -H "X-Skaha-Registry-Auth: ${REGISTRY_AUTH}" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H 'Accept: application/json' \
  --data '')
echo "POST HTTP ${HTTP} body=$(cat /tmp/skaha-create.txt)"
SESSION_ID=$(tr -d '[:space:]' < /tmp/skaha-create.txt)
if [ "$HTTP" -lt 200 ] || [ "$HTTP" -ge 300 ] || [ -z "$SESSION_ID" ]; then
  exit 1
fi

START=$(date +%s)
FINAL=''
while true; do
  ELAPSED=$(( $(date +%s) - START ))
  if [ "$ELAPSED" -gt "$POLL_MAX" ]; then FINAL='TIMEOUT'; break; fi
  curl -sS -o /tmp/skaha-get.json -H "Authorization: Bearer ${TOKEN}" \
    -H 'X-Skaha-Authentication-Type: RUNTIME-TOKEN' \
    "${BASE}/session/${SESSION_ID}" >/dev/null
  STATUS=$(python3 -c "import json; print(json.load(open('/tmp/skaha-get.json')).get('status','?'))")
  REQRAM=$(python3 -c "import json; print(json.load(open('/tmp/skaha-get.json')).get('requestedRAM','?'))")
  echo "$(date -u +%H:%M:%S) +${ELAPSED}s status=${STATUS} requestedRAM=${REQRAM}"
  case "$STATUS" in
    Succeeded|Completed|Failed|Error) FINAL="$STATUS"; break ;;
  esac
  sleep "$POLL_INTERVAL"
done

DEL_HTTP=$(curl -sS -w '%{http_code}' -o /dev/null -X DELETE "${BASE}/session/${SESSION_ID}" \
  -H "Authorization: Bearer ${TOKEN}" -H 'X-Skaha-Authentication-Type: RUNTIME-TOKEN')
echo "DELETE HTTP ${DEL_HTTP} RESULT=${FINAL} (${ELAPSED}s)"
case "$FINAL" in Succeeded|Completed) exit 0 ;; *) exit 1 ;; esac
