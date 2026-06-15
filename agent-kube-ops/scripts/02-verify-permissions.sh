#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/utils.sh"

FAILED=0

echo "--- Checking AWS identity ---"
aws sts get-caller-identity --output json || { echo "FAIL: Unable to get AWS identity"; FAILED=1; }

echo "--- Checking ECR access ---"
ECR_REPO=$(read_infra "ecr_repository_uri" 2>/dev/null || echo "")
if [ -n "$ECR_REPO" ]; then
  aws ecr describe-repositories --repository-names "$ECR_REPO" --output json > /dev/null 2>&1 || {
    echo "FAIL: Cannot access ECR repository $ECR_REPO"; FAILED=1;
  }
fi

echo "--- Checking kubeconfig / cluster access ---"
kubectl cluster-info --request-timeout=5s || { echo "FAIL: Cannot reach Kubernetes cluster"; FAILED=1; }

echo "--- Checking kubectl auth ---"
kubectl auth can-i create deployment --all-namespaces --request-timeout=5s 2>/dev/null || {
  echo "FAIL: Missing permission to create deployments"; FAILED=1;
}
kubectl auth can-i create service --all-namespaces --request-timeout=5s 2>/dev/null || {
  echo "FAIL: Missing permission to create services"; FAILED=1;
}
kubectl auth can-i create ingress --all-namespaces --request-timeout=5s 2>/dev/null || {
  echo "FAIL: Missing permission to create ingresses"; FAILED=1;
}

if [ $FAILED -ne 0 ]; then
  echo "FAIL: $FAILED permission check(s) failed."
  exit 1
fi

echo "PASS: All permissions verified."
