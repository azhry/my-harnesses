#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "==> agent-kube-ops init"
echo "==> Working directory: $PWD"
echo ""

echo "==> Gate 1: Checking tool readiness..."
if ! GIT_REPO="${GIT_REPO:-}" bash scripts/01-check-tools.sh; then
  echo "FAIL: Tool readiness check failed. Fix the reported issues and re-run init."
  exit 1
fi
echo ""

echo "==> Gate 2: Verifying permissions..."
if ! bash scripts/02-verify-permissions.sh; then
  echo "FAIL: Permission verification failed. Fix access issues and re-run init."
  exit 1
fi
echo ""

echo "==> Init complete. All gates pass."
echo "==> Next: bash scripts/03-deploy-app.sh"
