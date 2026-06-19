#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/utils.sh"

FAILED=0

echo "=== AWS Account ==="
AWS_ID=$(aws sts get-caller-identity --output json 2>/dev/null || { echo "FAIL: Unable to get AWS identity"; FAILED=1; })
echo "$AWS_ID" | head -3
EXPECTED_ACCOUNT=$(read_infra "account_id" 2>/dev/null || echo "")
if [ -n "$EXPECTED_ACCOUNT" ]; then
  CURRENT_ACCOUNT=$(echo "$AWS_ID" | jq -r '.Account' 2>/dev/null || echo "")
  if [ "$CURRENT_ACCOUNT" = "$EXPECTED_ACCOUNT" ]; then
    echo "  Account: $CURRENT_ACCOUNT (matches infra.md)"
  else
    echo "  WARN: Connected as account $CURRENT_ACCOUNT, infra.md expects $EXPECTED_ACCOUNT"
  fi
fi

echo ""
echo "=== ECR ==="
ECR_REPO=$(read_infra "ecr_repository_uri" 2>/dev/null || echo "")
if [ -n "$ECR_REPO" ]; then
  if aws ecr describe-repositories --repository-names "$ECR_REPO" --output json &>/dev/null; then
    echo "  PASS: ECR repository accessible ($ECR_REPO)"
  else
    echo "  FAIL: Cannot access ECR repository $ECR_REPO"
    FAILED=1
  fi
else
  echo "  SKIP: ECR repository not configured in infra.md"
fi

echo ""
echo "=== S3 ==="
S3_BUCKET=$(read_infra "s3_bucket" 2>/dev/null || echo "")
if [ -n "$S3_BUCKET" ]; then
  if aws s3 ls "s3://$S3_BUCKET" &>/dev/null; then
    echo "  PASS: S3 bucket accessible (s3://$S3_BUCKET)"
  else
    echo "  WARN: Cannot list S3 bucket s3://$S3_BUCKET (may need s3:ListBucket)"
    aws s3api head-bucket --bucket "$S3_BUCKET" &>/dev/null && \
      echo "  PASS: S3 bucket exists (head-bucket)" || \
      echo "  WARN: S3 bucket $S3_BUCKET not accessible"
  fi
else
  echo "  SKIP: S3 bucket not configured in infra.md"
fi

echo ""
echo "=== RDS ==="
RDS_HOST=$(read_infra "rds_endpoint" 2>/dev/null || echo "")
RDS_PORT=$(read_infra "rds_port" 2>/dev/null || echo "5432")
if [ -n "$RDS_HOST" ]; then
  echo "  Checking connectivity to $RDS_HOST:$RDS_PORT ..."
  if timeout 5 bash -c "echo > /dev/tcp/$RDS_HOST/$RDS_PORT" 2>/dev/null; then
    echo "  PASS: RDS port $RDS_PORT reachable"
  elif command -v nc &>/dev/null && nc -z -w5 "$RDS_HOST" "$RDS_PORT" &>/dev/null; then
    echo "  PASS: RDS port $RDS_PORT reachable (via nc)"
  else
    echo "  WARN: RDS endpoint $RDS_HOST:$RDS_PORT not reachable (may need VPC/bastion)"
  fi
else
  echo "  SKIP: RDS endpoint not configured in infra.md"
fi

echo ""
echo "=== Kubernetes ==="
if kubectl cluster-info --request-timeout=5s &>/dev/null; then
  echo "  PASS: Cluster reachable"
else
  echo "  FAIL: Cannot reach Kubernetes cluster"
  FAILED=1
fi

echo "--- kubectl auth ---"
kubectl auth can-i create deployment --all-namespaces --request-timeout=5s 2>/dev/null && \
  echo "  PASS: Can create deployments" || \
  { echo "  FAIL: Missing permission to create deployments"; FAILED=1; }
kubectl auth can-i create service --all-namespaces --request-timeout=5s 2>/dev/null && \
  echo "  PASS: Can create services" || \
  { echo "  FAIL: Missing permission to create services"; FAILED=1; }
kubectl auth can-i create ingress --all-namespaces --request-timeout=5s 2>/dev/null && \
  echo "  PASS: Can create ingresses" || \
  { echo "  FAIL: Missing permission to create ingresses"; FAILED=1; }

echo ""
if [ $FAILED -ne 0 ]; then
  echo "FAIL: $FAILED check(s) failed."
  exit 1
fi

echo "PASS: All permissions verified."
