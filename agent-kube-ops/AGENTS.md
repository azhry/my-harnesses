# agent-kube-ops

Kubernetes deployment agent. Deploys apps from a remote git repository to EKS
by: verifying tool readiness, checking permissions, cloning the repo,
building/pushing to ECR, applying k8s manifests, and healthchecking the result.

## Platform Detection

The harness auto-detects your OS and selects the correct scripts:

| OS | Shell | Entry point |
|----|-------|-------------|
| Linux | bash | `bash init.sh` |
| macOS | zsh (or bash) | `bash init.sh` |
| Windows | PowerShell | `.\init.ps1` |
| Windows | Git Bash | `bash init.sh` |

## Startup Workflow

Before writing code or deploying:

1. Read `PROGRESS.md` for the latest deployment state and blocker.
2. Read `feature_list.json` and confirm the current deployment target.
3. Run `init.sh` (Linux/macOS/Git Bash) or `.\init.ps1` (PowerShell) — verifies tool readiness and baseline checks.
4. If init fails, run `bash scripts/setup.sh` (or `.\scripts\setup.ps1`) for guided configuration — it will check each tool, prompt for missing config, and write to `docs/infrastructure.md`.
5. Re-run init after setup. Do not proceed with a broken baseline.

## Workflow (gate-based)

Each gate must pass before the next gate opens. If a gate fails, report the
failure and do not proceed.

| Gate | Step | Verification |
|------|------|-------------|
| 1 | Tool readiness + git access | `GIT_REPO=<url> bash scripts/01-check-tools.sh` |
| 2 | Permissions | `scripts/02-verify-permissions.sh` |
| 3 | Deploy app (clone → build → push → apply) | `GIT_REPO=<url> bash scripts/03-deploy-app.sh` |
| 4 | Healthcheck | `scripts/04-healthcheck.sh` |

If gate 4 (healthcheck) fails:
- Roll back to the previous known-good deployment.
- Record the failure and rollback evidence in `PROGRESS.md`.
- Return to gate 2.

## Rules

- Do not skip gates. Run every gate script in order.
- Do not mark a deployment as done until gate 4 passes with evidence.
- App source must come from a remote git repo. Set GIT_REPO env var.
- Read the app code to determine production runtime before creating Dockerfile.
- One deployment at a time. No concurrent deployments.
- All secrets and env config go through ConfigMap/Secret manifests, never inline.
- Record every deployment attempt in `state/current-deployment.json`.

## Authentication & User Prompts

When a command fails because of missing or invalid credentials, stop and ask
the user for what is needed. Do not guess, generate, or fabricate tokens.

| Scenario | What to tell the user |
|----------|----------------------|
| `git clone` or `git ls-remote` fails (403/401/auth) | "Git authentication failed for `{repo}`. Please provide a personal access token, or configure SSH keys. Then re-run the gate." |
| `aws sts get-caller-identity` fails | "AWS credentials are not configured. Please run `aws configure` or set `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` environment variables. Then re-run init." |
| `kubectl cluster-info` fails (connection refused / unauthorized) | "kubectl cannot reach the Kubernetes cluster. Please configure kubeconfig (e.g. `aws eks update-kubeconfig --region {region} --name {cluster}`). Then re-run init." |
| `docker push` to ECR fails (auth) | "Docker cannot push to ECR. Check that AWS credentials are valid and the ECR repository exists. Then re-run the gate." |
| `kubectl auth can-i` returns "no" | "The current IAM role / kubeconfig user lacks permission to {action}. Please update IAM permissions or kubeconfig context." |
| ECR login fails | "ECR login failed. Ensure you have `ecr:GetAuthorizationToken` permission and the correct AWS identity." |

After the user provides credentials or fixes access, re-run the failed gate
from the beginning. Never skip re-verification after updating credentials.

## Verification Commands

```
# Linux / macOS / Git Bash
Setup:             bash scripts/setup.sh
Init:              bash init.sh
Tool readiness:    GIT_REPO=<url> bash scripts/01-check-tools.sh
Permissions:       bash scripts/02-verify-permissions.sh
Full deploy:       GIT_REPO=<url> bash scripts/03-deploy-app.sh
Healthcheck:       NAMESPACE=<ns> APP_NAME=<name> bash scripts/04-healthcheck.sh

# Windows PowerShell
Setup:             .\scripts\setup.ps1
Init:              .\init.ps1
Tool readiness:    $env:GIT_REPO="<url>"; .\scripts\01-check-tools.ps1
Permissions:       .\scripts\02-verify-permissions.ps1
Full deploy:       $env:GIT_REPO="<url>"; .\scripts\03-deploy-app.ps1
Healthcheck:       $env:NAMESPACE="<ns>"; $env:APP_NAME="<name>"; .\scripts\04-healthcheck.ps1
```

## Definition of Done

A deployment is done only when all four gates pass and evidence is recorded:

- tool readiness output captured
- permission check output captured
- deployment output captured (image tag, k8s manifest SHAs)
- healthcheck output captured (pod status + ingress response)

## Infrastructure Reference

See `docs/infrastructure.md` for AWS account details, ECR URIs, RDS endpoint,
S3 buckets, and cluster ingress DNS.

## End of Session

1. Update `PROGRESS.md` with the current deployment state.
2. Update `feature_list.json`.
3. Update `state/current-deployment.json`.
4. Record any unresolved risk or blocker.
5. Leave the repo in a state where `bash init.sh` (or `.\init.ps1` on Windows) passes.
