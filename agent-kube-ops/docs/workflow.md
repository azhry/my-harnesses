# Deployment Workflow

## Overview

Four-gate deployment pipeline for agent-kube-ops.

```
  ┌──────────┐
  │ Gate 1   │  Tool readiness (awscli, kubectl, docker, git, git remote)
  │ Check    │
  └────┬─────┘
       │ pass
       ▼
  ┌──────────┐
  │ Gate 2   │  Permissions (AWS IAM, ECR access, k8s RBAC)
  │ Verify   │
  └────┬─────┘
       │ pass
       ▼
  ┌──────────┐
  │ Gate 3   │  Deploy (clone → read code → Dockerfile → build/push → apply)
  │ Deploy   │
  └────┬─────┘
       │ pass
       ▼
  ┌──────────┐
  │ Gate 4   │  Healthcheck (pod ready + ingress response)
  │ Check    │
  └────┬─────┘
       │ pass
       ▼
  ┌──────────┐
  │  DONE    │
  └──────────┘
       │ fail
       ▼
  ┌──────────┐
  │ Rollback │  ← return to Gate 2
  └──────────┘
```

## Gate Details

### Gate 1: Tool readiness
Run: `GIT_REPO=<url> bash scripts/01-check-tools.sh`
Checks: aws CLI, kubectl, docker, git are installed. If GIT_REPO is set, also checks git remote is accessible.

### Gate 2: Permissions
Run: `bash scripts/02-verify-permissions.sh`
Checks:
- `aws sts get-caller-identity` succeeds
- ECR repository is accessible
- `kubectl cluster-info` succeeds
- kubectl auth: can create deployments, services, and ingresses

### Gate 3: Deploy
Run: `GIT_REPO=<url> bash scripts/03-deploy-app.sh`
Requires: `GIT_REPO` env var set to a valid git remote URL.
Steps the agent must complete before running this script:
1. Ensure `GIT_REPO` points to the remote git repo
2. Create a Dockerfile that matches the runtime (in the cloned repo after it's pulled)
3. Create k8s manifests in `templates/k8s/` (deployment, service, ingress, configmap/secret)
4. Ensure `__IMAGE__` placeholder exists in deployment.yaml for image substitution
5. Set `NAMESPACE` and `IMAGE_TAG` env vars

The script does:
1. Clones (or pulls) the remote repo into `workspace/<repo-name>`
2. Derives image tag from git commit hash
3. Validates Dockerfile exists in the cloned repo
4. Logs into ECR
5. Builds and pushes the Docker image
6. Substitutes `__IMAGE__` in k8s templates and applies them
7. Records deployment state (including git_repo and git_hash)

### Gate 4: Healthcheck
Run: `bash scripts/04-healthcheck.sh`
Requires: `APP_NAME` env var set (matching the deployment's `app` label)
Checks:
- Pods are running and ready (waits up to 120s)
- Ingress responds with HTTP 2xx (if ingress DNS is configured)

### Rollback
If healthcheck fails:
1. Record the failure in PROGRESS.md
2. Use `kubectl rollout undo` to revert the deployment
3. Return to Gate 2 (re-verify permissions before retrying)
