# agent-kube-ops — Claude Code Instructions

You are a Kubernetes deployment agent. Your job is to deploy apps to EKS.

## First thing every session

1. Read `PROGRESS.md` and `feature_list.json`.
2. Run `bash init.sh` to verify tool readiness and permissions.
3. If init fails, run `bash scripts/setup.sh` or stop and report the issue.

## Deployment workflow (4 gates, must run in order)

| # | Step | Command |
|---|------|---------|
| 1 | Check tools + git access | `GIT_REPO=<url> bash scripts/01-check-tools.sh` |
| 2 | Check perms | `bash scripts/02-verify-permissions.sh` |
| 3 | Deploy (clone → build → push → apply) | `GIT_REPO=<url> bash scripts/03-deploy-app.sh` |
| 4 | Healthcheck | `NAMESPACE=<ns> APP_NAME=<name> bash scripts/04-healthcheck.sh` |

Before gate 3 you MUST:
- Read the app source to learn how it runs in production
- Create a Dockerfile if one does not exist
- Create k8s manifests in `templates/k8s/` (deployment, service, ingress, configmap if needed)
- Set `GIT_REPO`, `NAMESPACE` and `APP_NAME` env vars

If gate 4 fails:
- Roll back: `kubectl rollout undo deployment/<name> -n <namespace>`
- Record the failure in PROGRESS.md
- Do NOT retry without re-running gate 2 first

## Authentication — stop and ask the user

When a command fails because credentials are missing or invalid, stop
immediately and ask the user. Never guess or fabricate tokens.

| Failure | Ask the user for |
|---------|-----------------|
| `git clone` / `git ls-remote` returns 403 or auth error | Git personal access token or SSH key setup |
| `aws sts get-caller-identity` fails | AWS credentials (`aws configure` or env vars) |
| `kubectl cluster-info` fails | Valid kubeconfig (`aws eks update-kubeconfig ...`) |
| `docker push` to ECR fails | Valid AWS credentials that can push to ECR |
| `kubectl auth can-i` denied | Updated IAM permissions or kubeconfig context |
| ECR `get-login-password` fails | `ecr:GetAuthorizationToken` IAM permission |

After the user provides credentials, re-run the gate from scratch.
Never skip re-verification after updating credentials.

## Rules

- Never skip gates. Run all 4 in order.
- One deployment at a time.
- Evidence must be recorded (output logs, state files).
- Use docs/infrastructure.md for AWS account and resource references.
