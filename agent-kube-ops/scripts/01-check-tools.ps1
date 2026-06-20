# Gate 1: Tool readiness (PowerShell)

$ROOT_DIR = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
. "$ROOT_DIR\scripts\utils.ps1"

Detect-Platform
$Script:FAILED = 0

$awsHint = "winget install Amazon.AWSCLI | choco install awscli"
$kubeHint = "winget install Kubernetes.kubectl | choco install kubernetes-cli"
$dockerHint = "winget install Docker.DockerDesktop | choco install docker-desktop"
$gitHint = "winget install Git.Git | choco install git"

function Check-And-Hint {
  param($Name, $VersionCmd, $Hint)
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) {
    $ver = & $Name --version 2>&1 | Select-Object -First 1
    Write-Output "  $Name: found ($ver)"
  } else {
    Write-Output "  $Name: NOT FOUND"
    Write-Output "    Install: $Hint"
    $Script:FAILED += 1
  }
}

Check-And-Hint -Name "aws" -VersionCmd "aws --version" -Hint $awsHint
Check-And-Hint -Name "kubectl" -VersionCmd "kubectl version --client" -Hint $kubeHint
Check-And-Hint -Name "docker" -VersionCmd "docker --version" -Hint $dockerHint
Check-And-Hint -Name "git" -VersionCmd "git --version" -Hint $gitHint

if ($env:GIT_REPO) {
  Write-Output "--- Checking git remote access: $env:GIT_REPO ---"
  $result = git ls-remote --heads $env:GIT_REPO 2>&1
  if ($LASTEXITCODE -eq 0) {
    Write-Output "  git remote: accessible"
  } else {
    Write-Output "  git remote: NOT accessible"
    Write-Output "  Check the URL or your git credentials."
    $Script:FAILED += 1
  }
} else {
  Write-Output "  (GIT_REPO not set — skipping remote git check)"
}

if ($Script:FAILED -ne 0) {
  Write-Output "FAIL: $Script:FAILED check(s) failed."
  Write-Output "Run: .\scripts\setup.ps1  (for guided setup)"
  exit 1
}

Write-Output "PASS: All required tools are ready."
exit 0
