# agent-kube-ops

Kubernetes deployment agent. Deploys apps from a remote git repository to EKS
by: verifying tool readiness, checking permissions, cloning the repo,
building/pushing to ECR, applying k8s manifests, and healthchecking the result.

## Startup Workflow

Before writing code or deploying:

1. Read `PROGRESS.md` for the latest deployment state and blocker.
2. Read `feature_list.json` and confirm the current deployment target.
3. Run `./init.sh` — verifies tool readiness and baseline checks (including git remote access if GIT_REPO is set).
4. If init fails, fix the reported issue first. Do not proceed with a broken baseline.

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

## Verification Commands

```
Tool readiness:    GIT_REPO=<url> bash scripts/01-check-tools.sh
Permissions:       bash scripts/02-verify-permissions.sh
Full deploy:       GIT_REPO=<url> bash scripts/03-deploy-app.sh
Healthcheck:       NAMESPACE=<ns> APP_NAME=<name> bash scripts/04-healthcheck.sh
Init:              bash init.sh
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
5. Leave the repo in a state where `bash init.sh` passes.
