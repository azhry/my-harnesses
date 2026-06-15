# Shared utilities for agent-kube-ops harness scripts (PowerShell).

$Script:ROOT_DIR = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$Script:INFRA_FILE = Join-Path $ROOT_DIR "docs" "infrastructure.md"
$Script:DEPLOY_STATE_FILE = Join-Path $ROOT_DIR "state" "current-deployment.json"

function Detect-Platform {
  if ($IsWindows -or $env:OS -match "Windows") {
    $platform = "windows"
    $shell = "powershell"
  } elseif ($IsLinux) {
    $platform = "linux"
    $shell = "bash"
  } elseif ($IsMacOS) {
    $platform = "macos"
    $shell = "zsh"
  } else {
    $platform = "unknown"
    $shell = "unknown"
  }
  Write-Output "Platform: $platform | Shell: $shell"
}

function Check-Tool {
  param($Name, $VersionCmd)
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) {
    $ver = cmd /c "$VersionCmd 2>&1" 2>$null
    if (-not $ver) { $ver = & $Name --version 2>&1 | Select-Object -First 1 }
    Write-Output "  $Name: found ($ver)"
  } else {
    Write-Output "  $Name: NOT FOUND"
    $Script:FAILED += 1
  }
}

function Read-Infra {
  param($Key)
  if (-not (Test-Path $INFRA_FILE)) { return "" }
  $lines = Get-Content $INFRA_FILE
  foreach ($line in $lines) {
    if ($line -match "^$Key:\s*(.+)") {
      return $matches[1]
    }
  }
  return ""
}

function Read-DeploymentState {
  param($Key)
  if (-not (Test-Path $DEPLOY_STATE_FILE)) { return "" }
  $json = Get-Content $DEPLOY_STATE_FILE -Raw | ConvertFrom-Json
  return $json.$Key
}

function Update-DeploymentState {
  param($Key, $Value)
  if (Test-Path $DEPLOY_STATE_FILE) {
    $json = Get-Content $DEPLOY_STATE_FILE -Raw | ConvertFrom-Json
    $json | Add-Member -MemberType NoteProperty -Name $Key -Value $Value -Force
    $json | ConvertTo-Json | Set-Content $DEPLOY_STATE_FILE
  }
}
