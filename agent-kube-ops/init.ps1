# agent-kube-ops init (PowerShell)

$ROOT_DIR = Split-Path -Parent $PSCommandPath
Set-Location $ROOT_DIR

. "$ROOT_DIR\scripts\utils.ps1"
Detect-Platform

Write-Output "==> agent-kube-ops init"
Write-Output "==> Working directory: $PWD"
Write-Output ""

Write-Output "==> Gate 1: Checking tool readiness..."
$env:GIT_REPO = if ($env:GIT_REPO) { $env:GIT_REPO } else { "" }
& "$ROOT_DIR\scripts\01-check-tools.ps1"
if ($LASTEXITCODE -ne 0) {
  Write-Output ""
  Write-Output "FAIL: Tool readiness check failed."
  Write-Output "Run setup to configure missing tools:"
  Write-Output "  .\scripts\setup.ps1"
  exit 1
}
Write-Output ""

Write-Output "==> Gate 2: Verifying permissions..."
& "$ROOT_DIR\scripts\02-verify-permissions.ps1"
if ($LASTEXITCODE -ne 0) {
  Write-Output ""
  Write-Output "FAIL: Permission verification failed."
  Write-Output "Run setup to configure AWS/k8s access:"
  Write-Output "  .\scripts\setup.ps1"
  exit 1
}
Write-Output ""

Write-Output "==> Init complete. All gates pass."
Write-Output "==> Next: scripts\03-deploy-app.ps1"
