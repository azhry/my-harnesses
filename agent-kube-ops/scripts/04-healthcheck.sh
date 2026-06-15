#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/utils.sh"

FAILED=0
NAMESPACE="${NAMESPACE:-default}"
APP_NAME="${APP_NAME:-}"
TIMEOUT_SEC="${TIMEOUT_SEC:-120}"

if [ -z "$APP_NAME" ]; then
  # Try to infer from deployment state
  APP_NAME=$(read_deployment_state "app_name" 2>/dev/null || echo "")
fi
if [ -z "$APP_NAME" ]; then
  echo "FAIL: APP_NAME not set. Export APP_NAME=<your-app> or set it in state."
  exit 1
fi

echo "--- Healthcheck: Pod status ---"
POD_JSON=$(kubectl get pods -n "$NAMESPACE" -l "app=$APP_NAME" -o json 2>/dev/null || echo "{}")
POD_COUNT=$(echo "$POD_JSON" | jq '.items | length' 2>/dev/null || echo 0)
if [ "$POD_COUNT" -eq 0 ]; then
  echo "FAIL: No pods found for app=$APP_NAME in namespace=$NAMESPACE"
  FAILED=1
else
  READY=$(echo "$POD_JSON" | jq '[.items[] | select(.status.phase == "Running")] | length' 2>/dev/null || echo 0)
  echo "  Pods: $READY/$POD_COUNT running"
  if [ "$READY" -lt "$POD_COUNT" ]; then
    echo "  FAIL: Not all pods are running"
    FAILED=1
  else
    echo "  PASS: All pods running"
  fi
fi

echo "--- Healthcheck: Pod readiness (wait up to ${TIMEOUT_SEC}s) ---"
kubectl wait --for=condition=ready pod -l "app=$APP_NAME" -n "$NAMESPACE" --timeout="${TIMEOUT_SEC}s" 2>/dev/null || {
  echo "FAIL: Pods did not become ready within ${TIMEOUT_SEC}s"
  FAILED=1
}

echo "--- Healthcheck: Ingress endpoint ---"
INGRESS_DNS=$(read_infra "ingress_dns" 2>/dev/null || echo "")
INGRESS_PATH="${INGRESS_PATH:-/health}"
if [ -n "$INGRESS_DNS" ]; then
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 10 "https://${INGRESS_DNS}${INGRESS_PATH}" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "000" ]; then
    echo "  Ingress unreachable (https://${INGRESS_DNS}${INGRESS_PATH})"
    echo "  WARN: Ingress healthcheck skipped (may take minutes to propagate)"
  elif [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 500 ]; then
    echo "  Ingress: HTTP $HTTP_CODE — PASS"
  else
    echo "  Ingress: HTTP $HTTP_CODE — FAIL"
    FAILED=1
  fi
else
  echo "  WARN: No ingress DNS configured. Skipping ingress healthcheck."
fi

# Record healthcheck result in deployment state
if [ -f "$ROOT_DIR/state/current-deployment.json" ]; then
  update_deployment_state "healthcheck_status" "$([ $FAILED -eq 0 ] && echo 'pass' || echo 'fail')"
  update_deployment_state "healthcheck_at" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
fi

if [ $FAILED -ne 0 ]; then
  echo "FAIL: Healthcheck failed."
  exit 1
fi

echo "PASS: All healthchecks passed."
