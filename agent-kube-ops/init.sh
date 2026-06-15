#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

source "$ROOT_DIR/scripts/utils.sh"
detect_platform

echo "==> agent-kube-ops init"
echo "==> Working directory: $PWD"
echo ""

echo "==> Gate 1: Checking tool readiness..."
if ! GIT_REPO="${GIT_REPO:-}" bash scripts/01-check-tools.sh; then
  echo ""
  echo "FAIL: Tool readiness check failed."
  echo "Run setup to configure missing tools:"
  echo "  bash scripts/setup.sh"
  exit 1
fi
echo ""

echo "==> Gate 2: Verifying permissions..."
if ! bash scripts/02-verify-permissions.sh; then
  echo ""
  echo "FAIL: Permission verification failed."
  echo "Run setup to configure AWS/k8s access:"
  echo "  bash scripts/setup.sh"
  exit 1
fi
echo ""

echo "==> Init complete. All gates pass."
echo "==> Next: bash scripts/03-deploy-app.sh"
echo "==> (On Windows, use: powershell -File scripts/03-deploy-app.ps1)"
