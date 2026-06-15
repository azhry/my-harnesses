#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/utils.sh"

detect_platform
echo "==> agent-kube-ops setup"
echo "This will check your environment and prompt for missing configuration."
echo ""

# ---- Tool checks ----
echo "=== Tools ==="

check_and_guide() {
  local name="$1"
  local version_cmd="$2"
  local install_hint="$3"

  if command -v "$name" &>/dev/null; then
    echo "  $name: found ($(eval "$version_cmd" 2>&1 | head -1))"
    return 0
  else
    echo "  $name: NOT FOUND"
    echo "    Install: $install_hint"
    read -r -p "    Installed it now? Press Enter to re-check, or type 'skip': " ans
    if [ "$ans" != "skip" ]; then
      if command -v "$name" &>/dev/null; then
        echo "    $name: now found"
        return 0
      else
        echo "    Still not found. You can install later and re-run setup."
      fi
    fi
    return 1
  fi
}

case "$PLATFORM" in
  linux)
    PKG_INSTALL="apt install -y <pkg> (Debian/Ubuntu) | yum install -y <pkg> (RHEL)"
    AWS_INSTALL="curl https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o awscliv2.zip && unzip awscliv2.zip && sudo ./aws/install"
    KUBE_INSTALL="curl -LO https://dl.k8s.io/release/v1.30.0/bin/linux/amd64/kubectl && chmod +x kubectl && sudo mv kubectl /usr/local/bin/"
    DOCKER_INSTALL="curl -fsSL https://get.docker.com | sh"
    ;;
  macos)
    PKG_INSTALL="brew install <pkg>"
    AWS_INSTALL="brew install awscli"
    KUBE_INSTALL="brew install kubectl"
    DOCKER_INSTALL="brew install --cask docker"
    ;;
  windows)
    PKG_INSTALL="choco install <pkg> | winget install <pkg>"
    AWS_INSTALL="winget install Amazon.AWSCLI || choco install awscli"
    KUBE_INSTALL="winget install Kubernetes.kubectl || choco install kubernetes-cli"
    DOCKER_INSTALL="winget install Docker.DockerDesktop || choco install docker-desktop"
    ;;
  *)
    PKG_INSTALL="<platform package manager>"
    AWS_INSTALL="https://aws.amazon.com/cli/"
    KUBE_INSTALL="https://kubernetes.io/docs/tasks/tools/"
    DOCKER_INSTALL="https://docs.docker.com/get-docker/"
    ;;
esac

check_and_guide "git" "git --version" "$PKG_INSTALL (replace <pkg> with git)"
check_and_guide "aws" "aws --version" "$AWS_INSTALL"
check_and_guide "kubectl" "kubectl version --client" "$KUBE_INSTALL"
check_and_guide "docker" "docker --version" "$DOCKER_INSTALL"

echo ""
echo "=== AWS Credentials ==="
if aws sts get-caller-identity --output json &>/dev/null; then
  echo "  AWS credentials: configured"
  aws sts get-caller-identity --output json 2>/dev/null | head -3
else
  echo "  AWS credentials: NOT configured"
  echo "  Run 'aws configure' to set up access keys."
  echo "  Or set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env vars."
  read -r -p "  Press Enter after configuring AWS, or type 'skip': " ans
  if [ "$ans" != "skip" ]; then
    if aws sts get-caller-identity &>/dev/null; then
      echo "  AWS credentials: now configured"
    fi
  fi
fi

echo ""
echo "=== Kubernetes kubeconfig ==="
if kubectl cluster-info --request-timeout=5s &>/dev/null; then
  echo "  kubectl: connected to cluster"
else
  echo "  kubectl: NOT connected"
  echo "  Configure kubeconfig with:"
  echo "    aws eks update-kubeconfig --region <region> --name <cluster-name>"
  echo "  Or set KUBECONFIG env var to your kubeconfig path."
  read -r -p "  Press Enter after configuring kubeconfig, or type 'skip': " ans
fi

echo ""
echo "=== Infrastructure Configuration ==="
INFRA_FILE="$ROOT_DIR/docs/infrastructure.md"
TEMPLATE_FILE="$ROOT_DIR/docs/infrastructure.template.md"

if [ ! -f "$INFRA_FILE" ]; then
  echo "  infrastructure.md not found."
  if [ -f "$TEMPLATE_FILE" ]; then
    cp "$TEMPLATE_FILE" "$INFRA_FILE"
    echo "  Created from template. Fill in the values below."
  else
    touch "$INFRA_FILE"
    echo "  Created empty file."
  fi
fi

prompt_infra() {
  local key="$1"
  local label="$2"
  local current
  current=$(read_infra "$key" 2>/dev/null || echo "")
  if [ -n "$current" ]; then
    echo "  $label: $current"
  else
    read -r -p "  Enter $label: " val
    if [ -n "$val" ]; then
      if grep -q "^${key}:" "$INFRA_FILE" 2>/dev/null; then
        if [[ "$PLATFORM" == "macos" ]]; then
          sed -i '' "s/^${key}:.*/${key}: ${val}/" "$INFRA_FILE"
        else
          sed -i "s/^${key}:.*/${key}: ${val}/" "$INFRA_FILE"
        fi
      else
        echo "${key}: ${val}" >> "$INFRA_FILE"
      fi
    fi
  fi
}

prompt_infra "account_id" "AWS Account ID (e.g. 123456789012)"
prompt_infra "region" "AWS Region (e.g. ap-southeast-3)"
prompt_infra "iam_role" "IAM Role ARN"
prompt_infra "ecr_repository" "ECR Repository Name"
prompt_infra "ecr_repository_uri" "ECR Repository URI (e.g. <account>.dkr.ecr.<region>.amazonaws.com/<repo>)"
prompt_infra "rds_endpoint" "RDS Endpoint (if applicable)"
prompt_infra "s3_bucket" "S3 Bucket Name (if applicable)"
prompt_infra "ingress_dns" "Ingress ALB DNS (if applicable)"
prompt_infra "acm_certificate_arn" "ACM Certificate ARN (if applicable)"

echo ""
echo "=== Setup Complete ==="
echo "Run 'bash init.sh' to verify everything works."
echo "Or run 'bash scripts/03-deploy-app.sh' to deploy."
