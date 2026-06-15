#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/utils.sh"

FAILED=0

check_tool "aws"       "aws --version"
check_tool "kubectl"   "kubectl version --client"
check_tool "docker"    "docker --version"
check_tool "git"       "git --version"

# Optional: check remote git repo access
if [ -n "${GIT_REPO:-}" ]; then
  echo "--- Checking git remote access: $GIT_REPO ---"
  if git ls-remote --heads "$GIT_REPO" &>/dev/null; then
    echo "  git remote: accessible"
  else
    echo "  git remote: NOT accessible"
    FAILED=$((FAILED + 1))
  fi
else
  echo "  (GIT_REPO not set — skipping remote git check)"
fi

if [ $FAILED -ne 0 ]; then
  echo "FAIL: $FAILED check(s) failed."
  exit 1
fi

echo "PASS: All required tools are ready."
