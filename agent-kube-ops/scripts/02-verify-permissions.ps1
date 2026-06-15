# Gate 2: Permissions (PowerShell)

$ROOT_DIR = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
. "$ROOT_DIR\scripts\utils.ps1"

$Script:FAILED = 0

Write-Output "--- Checking AWS identity ---"
aws sts get-caller-identity --output json
if ($LASTEXITCODE -ne 0) { Write-Output "FAIL: Unable to get AWS identity"; $Script:FAILED = 1 }

Write-Output "--- Checking ECR access ---"
$ecrRepo = Read-Infra -Key "ecr_repository_uri"
if ($ecrRepo) {
  aws ecr describe-repositories --repository-names $ecrRepo --output json *>$null
  if ($LASTEXITCODE -ne 0) { Write-Output "FAIL: Cannot access ECR repository $ecrRepo"; $Script:FAILED = 1 }
}

Write-Output "--- Checking kubeconfig / cluster access ---"
kubectl cluster-info --request-timeout=5s
if ($LASTEXITCODE -ne 0) { Write-Output "FAIL: Cannot reach Kubernetes cluster"; $Script:FAILED = 1 }

Write-Output "--- Checking kubectl auth ---"
$perms = @("create deployment", "create service", "create ingress")
foreach ($p in $perms) {
  $parts = $p -split " "
  kubectl auth can-i $parts[0] $parts[1] --all-namespaces --request-timeout=5s *>$null
  if ($LASTEXITCODE -ne 0) { Write-Output "FAIL: Missing permission to $p"; $Script:FAILED = 1 }
}

if ($Script:FAILED -ne 0) {
  Write-Output "FAIL: $Script:FAILED permission check(s) failed."
  exit 1
}

Write-Output "PASS: All permissions verified."
