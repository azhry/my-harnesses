# agent-kube-ops setup (PowerShell)

$ROOT_DIR = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
. "$ROOT_DIR\scripts\utils.ps1"

Detect-Platform
Write-Output "==> agent-kube-ops setup"
Write-Output "This will check your environment and prompt for missing configuration."
Write-Output ""

# ---- Tool checks ----
Write-Output "=== Tools ==="

function Check-And-Guide {
  param($Name, $VersionCmd, $InstallHint)

  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) {
    $ver = & $Name --version 2>&1 | Select-Object -First 1
    Write-Output "  $Name: found ($ver)"
    return $true
  } else {
    Write-Output "  $Name: NOT FOUND"
    Write-Output "    Install: $InstallHint"
    $ans = Read-Host "    Installed it now? Press Enter to re-check, or type 'skip'"
    if ($ans -ne "skip") {
      $cmd = Get-Command $Name -ErrorAction SilentlyContinue
      if ($cmd) {
        Write-Output "    $Name: now found"
        return $true
      } else {
        Write-Output "    Still not found. You can install later and re-run setup."
      }
    }
    return $false
  }
}

$awsHint = "winget install Amazon.AWSCLI | choco install awscli"
$kubeHint = "winget install Kubernetes.kubectl | choco install kubernetes-cli"
$dockerHint = "winget install Docker.DockerDesktop | choco install docker-desktop"
$gitHint = "winget install Git.Git | choco install git"

Check-And-Guide -Name "git" -VersionCmd "git --version" -InstallHint $gitHint | Out-Null
Check-And-Guide -Name "aws" -VersionCmd "aws --version" -InstallHint $awsHint | Out-Null
Check-And-Guide -Name "kubectl" -VersionCmd "kubectl version --client" -InstallHint $kubeHint | Out-Null
Check-And-Guide -Name "docker" -VersionCmd "docker --version" -InstallHint $dockerHint | Out-Null

Write-Output ""
Write-Output "=== AWS Credentials ==="
try {
  $identity = aws sts get-caller-identity --output json 2>$null | ConvertFrom-Json
  Write-Output "  AWS credentials: configured"
  Write-Output "  Account: $($identity.Account)"
  Write-Output "  Arn: $($identity.Arn)"
} catch {
  Write-Output "  AWS credentials: NOT configured"
  Write-Output "  Run 'aws configure' to set up access keys."
  Write-Output "  Or set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env vars."
  Read-Host "  Press Enter after configuring AWS"
}

Write-Output ""
Write-Output "=== Kubernetes kubeconfig ==="
$clusterInfo = kubectl cluster-info --request-timeout=5s 2>$null
if ($LASTEXITCODE -eq 0) {
  Write-Output "  kubectl: connected to cluster"
} else {
  Write-Output "  kubectl: NOT connected"
  Write-Output "  Configure kubeconfig with:"
  Write-Output "    aws eks update-kubeconfig --region <region> --name <cluster-name>"
  Read-Host "  Press Enter after configuring kubeconfig"
}

Write-Output ""
Write-Output "=== Infrastructure Configuration ==="
$infraFile = Join-Path (Join-Path $ROOT_DIR "docs") "infrastructure.md"
$templateFile = Join-Path (Join-Path $ROOT_DIR "docs") "infrastructure.template.md"

if (-not (Test-Path $infraFile)) {
  Write-Output "  infrastructure.md not found."
  if (Test-Path $templateFile) {
    Copy-Item $templateFile $infraFile
    Write-Output "  Created from template."
  } else {
    New-Item -ItemType File $infraFile -Force | Out-Null
    Write-Output "  Created empty file."
  }
}

function Prompt-Infra {
  param($Key, $Label)
  $current = Read-Infra -Key $Key
  if ($current) {
    Write-Output "  $Label: $current"
  } else {
    $val = Read-Host "  Enter $Label"
    if ($val) {
      $content = Get-Content $infraFile -Raw
      if ($content -match "^$Key:") {
        $content = $content -replace "^$Key:.*", "$Key: $val"
        Set-Content $infraFile $content
      } else {
        Add-Content $infraFile "$Key: $val"
      }
    }
  }
}

Prompt-Infra -Key "account_id" -Label "AWS Account ID (e.g. 123456789012)"
Prompt-Infra -Key "region" -Label "AWS Region (e.g. ap-southeast-3)"
Prompt-Infra -Key "iam_role" -Label "IAM Role ARN"
Prompt-Infra -Key "ecr_repository" -Label "ECR Repository Name"
Prompt-Infra -Key "ecr_repository_uri" -Label "ECR Repository URI"
Prompt-Infra -Key "rds_endpoint" -Label "RDS Endpoint (if applicable)"
Prompt-Infra -Key "s3_bucket" -Label "S3 Bucket Name (if applicable)"
Prompt-Infra -Key "ingress_dns" -Label "Ingress ALB DNS (if applicable)"
Prompt-Infra -Key "acm_certificate_arn" -Label "ACM Certificate ARN (if applicable)"

Write-Output ""
Write-Output "=== Setup Complete ==="
Write-Output "Run '.\init.ps1' to verify everything works."
Write-Output "Or run '.\scripts\03-deploy-app.ps1' to deploy."
