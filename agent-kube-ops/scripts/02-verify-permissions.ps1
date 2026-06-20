# Gate 2: Permissions (PowerShell)

$ROOT_DIR = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
. "$ROOT_DIR\scripts\utils.ps1"

$Script:FAILED = 0

Write-Output "=== AWS Account ==="
try {
  $identity = aws sts get-caller-identity --output json 2>$null | ConvertFrom-Json
  Write-Output "  Account: $($identity.Account)"
  Write-Output "  Arn: $($identity.Arn)"
  Write-Output "  UserId: $($identity.UserId)"
  $expected = Read-Infra -Key "account_id"
  if ($expected -and $identity.Account -ne $expected) {
    Write-Output "  WARN: Connected as account $($identity.Account), infra.md expects $expected"
  }
} catch {
  Write-Output "FAIL: Unable to get AWS identity"
  $Script:FAILED = 1
}

Write-Output ""
Write-Output "=== ECR ==="
$ecrRepo = Read-Infra -Key "ecr_repository_uri"
if ($ecrRepo) {
  aws ecr describe-repositories --repository-names $ecrRepo --output json *>$null
  if ($LASTEXITCODE -eq 0) {
    Write-Output "  PASS: ECR repository accessible ($ecrRepo)"
  } else {
    Write-Output "  FAIL: Cannot access ECR repository $ecrRepo"
    $Script:FAILED = 1
  }
} else {
  Write-Output "  SKIP: ECR repository not configured in infra.md"
}

Write-Output ""
Write-Output "=== S3 ==="
$s3bucket = Read-Infra -Key "s3_bucket"
if ($s3bucket) {
  aws s3 ls "s3://$s3bucket" *>$null
  if ($LASTEXITCODE -eq 0) {
    Write-Output "  PASS: S3 bucket accessible (s3://$s3bucket)"
  } else {
    Write-Output "  WARN: Cannot list S3 bucket s3://$s3bucket"
    aws s3api head-bucket --bucket $s3bucket *>$null
    if ($LASTEXITCODE -eq 0) {
      Write-Output "  PASS: S3 bucket exists (head-bucket)"
    } else {
      Write-Output "  WARN: S3 bucket $s3bucket not accessible"
    }
  }
} else {
  Write-Output "  SKIP: S3 bucket not configured in infra.md"
}

Write-Output ""
Write-Output "=== RDS ==="
$rdsHost = Read-Infra -Key "rds_endpoint"
$rdsPort = Read-Infra -Key "rds_port"
if (-not $rdsPort) { $rdsPort = "5432" }
if ($rdsHost) {
  Write-Output "  Checking connectivity to $($rdsHost):$($rdsPort) ..."
  $result = Test-NetConnection -ComputerName $rdsHost -Port $rdsPort -WarningAction SilentlyContinue -InformationLevel Quiet 2>$null
  if ($result) {
    Write-Output "  PASS: RDS port $rdsPort reachable"
  } else {
    Write-Output "  WARN: RDS endpoint $($rdsHost):$($rdsPort) not reachable (may need VPC/bastion)"
  }
} else {
  Write-Output "  SKIP: RDS endpoint not configured in infra.md"
}

Write-Output ""
Write-Output "=== Kubernetes ==="
kubectl cluster-info --request-timeout=5s *>$null
if ($LASTEXITCODE -eq 0) {
  Write-Output "  PASS: Cluster reachable"
} else {
  Write-Output "  FAIL: Cannot reach Kubernetes cluster"
  $Script:FAILED = 1
}

$infraNamespace = Read-Infra -Key "namespace"
$namespace = if ($env:NAMESPACE) { $env:NAMESPACE } elseif ($infraNamespace) { $infraNamespace } else { "" }

if ($namespace) {
  Write-Output "Checking permissions in namespace: $namespace"
} else {
  Write-Output "Checking permissions in all namespaces"
}

Write-Output "--- kubectl auth ---"
$perms = @(
  @{Verb="create"; Resource="deployment"},
  @{Verb="create"; Resource="service"},
  @{Verb="create"; Resource="ingress"}
)
foreach ($p in $perms) {
  if ($namespace) {
    kubectl auth can-i $p.Verb $p.Resource -n $namespace --request-timeout=5s *>$null
  } else {
    kubectl auth can-i $p.Verb $p.Resource --all-namespaces --request-timeout=5s *>$null
  }
  if ($LASTEXITCODE -eq 0) {
    Write-Output "  PASS: Can $($p.Verb) $($p.Resource)"
  } else {
    $nsName = if ($namespace) { $namespace } else { "all" }
    Write-Output "  FAIL: Missing permission to $($p.Verb) $($p.Resource) (namespace: $nsName)"
    $Script:FAILED = 1
  }
}

Write-Output ""
if ($Script:FAILED -ne 0) {
  Write-Output "FAIL: $Script:FAILED check(s) failed."
  exit 1
}

Write-Output "PASS: All permissions verified."
exit 0
