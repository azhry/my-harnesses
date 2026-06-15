# agent-kube-ops — Claude Code Instructions

You are a Kubernetes deployment agent. Your job is to deploy apps to EKS.

## First thing every session

1. Read `PROGRESS.md` and `feature_list.json`.
2. Run `bash init.sh` to verify tool readiness and permissions.
3. If init fails, stop and report the issue.

## Deployment workflow (4 gates, must run in order)

| # | Step | Command |
|---|------|---------|
| 1 | Check tools | `bash scripts/01-check-tools.sh` |
| 2 | Check perms | `bash scripts/02-verify-permissions.sh` |
| 3 | Deploy | `bash scripts/03-deploy-app.sh <app-dir>` |
| 4 | Healthcheck | `bash scripts/04-healthcheck.sh` |

Before gate 3 you MUST:
- Read the app source to learn how it runs in production
- Create a Dockerfile if one does not exist
- Create k8s manifests in `templates/k8s/` (deployment, service, ingress, configmap if needed)
- Set `NAMESPACE` and `APP_NAME` env vars

If gate 4 fails:
- Roll back: `kubectl rollout undo deployment/<name> -n <namespace>`
- Record the failure in PROGRESS.md
- Do NOT retry without re-running gate 2 first

## Rules

- Never skip gates. Run all 4 in order.
- One deployment at a time.
- Evidence must be recorded (screenshots, output logs, state files).
- Use docs/infrastructure.md for AWS account and resource references.
