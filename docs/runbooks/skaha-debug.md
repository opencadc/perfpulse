# Skaha debug runbook

See ADR-0004 for the full integration contract. Use this runbook before escalating to in-cluster
debug pods.

## Local session smoke (60s workload)

From repo root, with kubectl access to read `perfpulse-skaha-auth` in `canfar-perfpulse`:

```bash
bash scripts/skaha-session-smoke.sh
```

Optional overrides:

```bash
SKAHA_API_URL='https://staging.canfar.net/skaha/v1' \
SKAHA_LOGIN_URL='https://ws-cadc.canfar.net/ac/login' \
SKAHA_SECRET_NAMESPACE=canfar-perfpulse \
SKAHA_SECRET_NAME=perfpulse-skaha-auth \
bash scripts/skaha-session-smoke.sh
```

Success: POST 200, session reaches `Completed` or `Succeeded` within ~90s for a 60s workload,
DELETE 200.

## Skaha Tomcat logs

```bash
kubectl logs --since 5m deployments/canfar-skaha-staging-skaha-tomcat -n canfar-system-staging
```

## Common failures

| Symptom | Likely cause |
|---------|----------------|
| POST 400 missing `image` | Missing `Content-Type: application/x-www-form-urlencoded` or non-empty POST body |
| POST 400 registry auth | Missing `X-Skaha-Registry-Auth` for `images.canfar.net/...` |
| Init `exec format error` | Workload image not published for **linux/amd64** |
| Session `Failed` quickly, workload ~0s | Broken `--stressors cpu` args (lists stressors and exits) |
| GET shows `requestedRAM=1.07` | Server display quirk; client still sends integer `ram=1` |
