#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/utils.sh"

detect_platform
FAILED=0

case "$PLATFORM" in
  linux)
    AWS_HINT="curl https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o awscliv2.zip && unzip awscliv2.zip && sudo ./aws/install"
    KUBE_HINT="curl -LO https://dl.k8s.io/release/v1.30.0/bin/linux/amd64/kubectl && chmod +x kubectl && sudo mv kubectl /usr/local/bin/"
    DOCKER_HINT="curl -fsSL https://get.docker.com | sh"
    GIT_HINT="apt install -y git | yum install -y git"
    ;;
  macos)
    AWS_HINT="brew install awscli"
    KUBE_HINT="brew install kubectl"
    DOCKER_HINT="brew install --cask docker"
    GIT_HINT="brew install git"
    ;;
  windows)
    AWS_HINT="winget install Amazon.AWSCLI | choco install awscli"
    KUBE_HINT="winget install Kubernetes.kubectl | choco install kubernetes-cli"
    DOCKER_HINT="winget install Docker.DockerDesktop | choco install docker-desktop"
    GIT_HINT="winget install Git.Git | choco install git"
    ;;
  *)
    AWS_HINT="https://aws.amazon.com/cli/"
    KUBE_HINT="https://kubernetes.io/docs/tasks/tools/"
    DOCKER_HINT="https://docs.docker.com/get-docker/"
    GIT_HINT="https://git-scm.com/downloads"
    ;;
esac

check_and_hint() {
  local name="$1"
  local version_cmd="$2"
  local hint="$3"
  if command -v "$name" &> /dev/null; then
    echo "  $name: found ($(eval "$version_cmd" 2>&1 | head -1))"
  else
    echo "  $name: NOT FOUND"
    echo "    Install: $hint"
    FAILED=$((FAILED + 1))
  fi
}

check_and_hint "aws"     "aws --version"     "$AWS_HINT"
check_and_hint "kubectl" "kubectl version --client" "$KUBE_HINT"
check_and_hint "docker"  "docker --version"  "$DOCKER_HINT"
check_and_hint "git"     "git --version"     "$GIT_HINT"

# Optional: check remote git repo access
if [ -n "${GIT_REPO:-}" ]; then
  echo "--- Checking git remote access: $GIT_REPO ---"
  if git ls-remote --heads "$GIT_REPO" &>/dev/null; then
    echo "  git remote: accessible"
  else
    echo "  git remote: NOT accessible"
    echo "  Check the URL or your git credentials."
    FAILED=$((FAILED + 1))
  fi
else
  echo "  (GIT_REPO not set — skipping remote git check)"
fi

if [ $FAILED -ne 0 ]; then
  echo "FAIL: $FAILED check(s) failed."
  echo "Run: bash scripts/setup.sh  (for guided setup)"
  exit 1
fi

echo "PASS: All required tools are ready."
