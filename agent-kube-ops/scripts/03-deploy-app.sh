#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/utils.sh"

WORKSPACE_DIR="$ROOT_DIR/workspace"

# ---- Phase 1: Clone the remote git repo ----
echo "=== Phase 1: Cloning app code ==="

if [ -z "${GIT_REPO:-}" ]; then
  echo "FAIL: GIT_REPO environment variable is not set. Provide the remote git URL."
  exit 1
fi

REPO_NAME=$(basename "$GIT_REPO" .git)
APP_DIR="$WORKSPACE_DIR/$REPO_NAME"

if [ -d "$APP_DIR/.git" ]; then
  echo "Repo already cloned at $APP_DIR — pulling latest..."
  git -C "$APP_DIR" pull
else
  echo "Cloning $GIT_REPO into $APP_DIR..."
  mkdir -p "$WORKSPACE_DIR"
  git clone "$GIT_REPO" "$APP_DIR"
fi

echo "App source: $APP_DIR"

# ---- Phase 2: Discover how the app runs in production ----
echo "=== Phase 2: Reading app code ==="
cd "$APP_DIR"

if [ ! -f "package.json" ] && [ ! -f "requirements.txt" ] && [ ! -f "Cargo.toml" ] && [ ! -f "go.mod" ] && [ ! -f "pom.xml" ] && [ ! -f "build.gradle" ]; then
  echo "WARN: No recognized runtime file found. Agent must inspect the code manually."
fi

# ---- Phase 3: Build and push to ECR ----
echo "=== Phase 3: Building and pushing to ECR ==="
ECR_URI=$(read_infra "ecr_repository_uri")
REGION=$(read_infra "region")

# Derive image tag from git commit hash
GIT_HASH=$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo "")
IMAGE_TAG="${IMAGE_TAG:-${GIT_HASH:-$(date +%s)}}"
FULL_IMAGE="${ECR_URI}:${IMAGE_TAG}"

echo "Image: $FULL_IMAGE"

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR_URI" > /dev/null

# Agent should ensure Dockerfile exists before this runs.
if [ ! -f "$APP_DIR/Dockerfile" ]; then
  echo "FAIL: No Dockerfile found in $APP_DIR. Agent must create one first."
  exit 1
fi

docker build -t "$FULL_IMAGE" "$APP_DIR"
docker push "$FULL_IMAGE"

# ---- Phase 4: Create and apply k8s manifests ----
echo "=== Phase 4: Applying Kubernetes manifests ==="
INFRA_NAMESPACE=$(read_infra "namespace" 2>/dev/null || echo "")
NAMESPACE="${NAMESPACE:-${INFRA_NAMESPACE:-default}}"
MANIFEST_DIR="$ROOT_DIR/templates/k8s"

if [ -d "$MANIFEST_DIR" ]; then
  for f in "$MANIFEST_DIR"/*.yaml; do
    [ -f "$f" ] || continue
    sed "s|__IMAGE__|$FULL_IMAGE|g; s|__NAMESPACE__|$NAMESPACE|g" "$f" | kubectl apply -f -
  done
else
  echo "FAIL: No k8s manifest templates found. Agent must create them first."
  exit 1
fi

# ---- Phase 5: Record deployment state ----
echo "=== Phase 5: Recording deployment state ==="
cat > "$ROOT_DIR/state/current-deployment.json" <<DEPLOYEOF
{
  "git_repo": "$GIT_REPO",
  "git_hash": "$GIT_HASH",
  "image": "$FULL_IMAGE",
  "namespace": "$NAMESPACE",
  "deployed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "status": "deployed"
}
DEPLOYEOF

echo "PASS: Deployment submitted. Run scripts/04-healthcheck.sh to verify."
