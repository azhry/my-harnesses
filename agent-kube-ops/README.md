# agent-kube-ops

AI agent harness for deploying applications to EKS. Four-gate pipeline: tool readiness → permissions → deploy → healthcheck.

## How Humans Should Use This Harness

### 0. Run setup first (guided configuration)

If tools or infrastructure config are missing, run setup for guided prompts:

```bash
# Linux / macOS
bash scripts/setup.sh

# Windows PowerShell
.\scripts\setup.ps1
```

Setup checks for: awscli, kubectl, docker, git — shows install commands per platform if missing. Prompts for AWS credentials, kubeconfig, and infrastructure values (account ID, region, ECR, etc.). Writes everything to `docs/infrastructure.md`.

### 1. Start an AI agent session in this directory

Open your AI coding agent (Claude Code, Codex, etc.) in the `agent-kube-ops/` directory.

### 2. Give the agent a deployment goal

Example prompt:

> Deploy the app from `https://github.com/org/my-app.git` to the EKS cluster using the harness in this directory. Set GIT_REPO=https://github.com/org/my-app.git, NAMESPACE=production and APP_NAME=my-app.

The agent reads `AGENTS.md` and follows the four-gate workflow automatically.

### 3. Let the agent run the gates

The agent will:
1. Run `init.sh` (Linux/macOS) or `.\init.ps1` (Windows) — detects platform, checks tools + permissions
2. Clone the remote git repo into `workspace/`
3. Inspect your app code to determine the production runtime
4. Create a Dockerfile (if missing), build and push to ECR
5. Create k8s manifests from templates in `templates/k8s/`
6. Apply manifests to the cluster
7. Run healthchecks against pods and ingress
8. Roll back automatically if healthcheck fails, then retry from gate 2

### 4. Verify state between sessions

- Read `PROGRESS.md` for the latest deployment state and blockers
- Read `feature_list.json` for what's been deployed and what's pending
- Read `state/current-deployment.json` for the last deployed image and healthcheck result

### 5. Manual overrides

If you need to intervene:

```bash
# Linux / macOS / Git Bash
GIT_REPO=https://github.com/org/my-app.git bash scripts/01-check-tools.sh
bash scripts/02-verify-permissions.sh
GIT_REPO=https://github.com/org/my-app.git NAMESPACE=my-ns APP_NAME=my-app IMAGE_TAG=v1.0 bash scripts/03-deploy-app.sh
NAMESPACE=my-ns APP_NAME=my-app bash scripts/04-healthcheck.sh
kubectl rollout undo deployment/my-app -n my-ns
```

```powershell
# Windows PowerShell
$env:GIT_REPO="https://github.com/org/my-app.git"; .\scripts\01-check-tools.ps1
.\scripts\02-verify-permissions.ps1
$env:GIT_REPO="https://github.com/org/my-app.git"; $env:NAMESPACE="my-ns"; $env:APP_NAME="my-app"; $env:IMAGE_TAG="v1.0"; .\scripts\03-deploy-app.ps1
$env:NAMESPACE="my-ns"; $env:APP_NAME="my-app"; .\scripts\04-healthcheck.ps1
kubectl rollout undo deployment/my-app -n my-ns
```

### 6. Use the Web UI (manual mode)

Run the dashboard to execute the pipeline through a browser:

```bash
cd ui
npm start
# Open http://localhost:3456
```

The UI shows all 4 gates as cards. Configure git repo URL, namespace, and app name in the sidebar, then click **Run** on each gate in order. Output streams live into the log panel at the bottom. Use the **Rollback** button if a deployment fails.

### 7. Infrastructure reference

All AWS account details, ECR URIs, RDS endpoints, ingress DNS, and cert ARNs are in `docs/infrastructure.md`. Update this file when infrastructure changes.

## File Map

| File | Purpose |
|------|---------|
| AGENTS.md | Root instructions — agent reads this first |
| CLAUDE.md | Claude Code-specific instructions |
| init.sh / init.ps1 | Startup: tools + permissions check (auto-detects OS) |
| scripts/01-check-tools.sh / .ps1 | Gate 1: verify CLI tools + git remote access |
| scripts/02-verify-permissions.sh / .ps1 | Gate 2: verify AWS/k8s access |
| scripts/03-deploy-app.sh / .ps1 | Gate 3: clone repo, build, push, apply |
| scripts/04-healthcheck.sh / .ps1 | Gate 4: pod + ingress healthcheck |
| scripts/setup.sh / setup.ps1 | Guided setup — prompts for missing tools and config |
| scripts/utils.sh / utils.ps1 | Shared utilities + platform detection |
| PROGRESS.md | Session state log |
| feature_list.json | Feature/deployment tracking |
| state/current-deployment.json | Last deployment record (git_repo, git_hash, image, status) |
| docs/infrastructure.md | AWS account and resource reference |
| workspace/ | Cloned app repos (one subdir per GIT_REPO) |
| docs/workflow.md | Detailed pipeline documentation |
| templates/k8s/*.yaml | K8s manifest templates |
