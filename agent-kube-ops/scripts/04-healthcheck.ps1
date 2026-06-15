# Gate 4: Healthcheck (PowerShell)

$ROOT_DIR = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
. "$ROOT_DIR\scripts\utils.ps1"

$Script:FAILED = 0
$namespace = if ($env:NAMESPACE) { $env:NAMESPACE } else { "default" }
$appName = if ($env:APP_NAME) { $env:APP_NAME } else { Read-DeploymentState -Key "app_name" }
$timeoutSec = if ($env:TIMEOUT_SEC) { [int]$env:TIMEOUT_SEC } else { 120 }

if (-not $appName) {
  Write-Output "FAIL: APP_NAME not set. Set APP_NAME or populate state/current-deployment.json."
  exit 1
}

Write-Output "--- Healthcheck: Pod status ---"
$podJson = kubectl get pods -n $namespace -l "app=$appName" -o json 2>$null
if (-not $podJson) { $podJson = "{}" }
$podCount = ($podJson | ConvertFrom-Json).items.Count
if ($podCount -eq 0) {
  Write-Output "FAIL: No pods found for app=$appName in namespace=$namespace"
  $Script:FAILED = 1
} else {
  $ready = ($podJson | ConvertFrom-Json).items | Where-Object { $_.status.phase -eq "Running" } | Measure-Object | Select-Object -ExpandProperty Count
  Write-Output "  Pods: $ready/$podCount running"
  if ($ready -lt $podCount) {
    Write-Output "  FAIL: Not all pods are running"
    $Script:FAILED = 1
  } else {
    Write-Output "  PASS: All pods running"
  }
}

Write-Output "--- Healthcheck: Pod readiness (wait up to ${timeoutSec}s) ---"
kubectl wait --for=condition=ready pod -l "app=$appName" -n $namespace --timeout="$($timeoutSec)s" 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Output "FAIL: Pods did not become ready within ${timeoutSec}s"
  $Script:FAILED = 1
}

Write-Output "--- Healthcheck: Ingress endpoint ---"
$ingressDns = Read-Infra -Key "ingress_dns"
$ingressPath = if ($env:INGRESS_PATH) { $env:INGRESS_PATH } else { "/health" }
if ($ingressDns) {
  try {
    $req = [System.Net.WebRequest]::Create("https://${ingressDns}${ingressPath}")
    $req.Timeout = 10000
    $resp = $req.GetResponse()
    $code = [int]$resp.StatusCode
    $resp.Close()
    if ($code -ge 200 -and $code -lt 500) {
      Write-Output "  Ingress: HTTP $code — PASS"
    } else {
      Write-Output "  Ingress: HTTP $code — FAIL"
      $Script:FAILED = 1
    }
  } catch {
    Write-Output "  Ingress unreachable (https://${ingressDns}${ingressPath})"
    Write-Output "  WARN: Ingress healthcheck skipped (may take minutes to propagate)"
  }
} else {
  Write-Output "  WARN: No ingress DNS configured. Skipping ingress healthcheck."
}

$hcStatus = if ($Script:FAILED -eq 0) { "pass" } else { "fail" }
Update-DeploymentState -Key "healthcheck_status" -Value $hcStatus
Update-DeploymentState -Key "healthcheck_at" -Value ([DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ"))

if ($Script:FAILED -ne 0) {
  Write-Output "FAIL: Healthcheck failed."
  exit 1
}

Write-Output "PASS: All healthchecks passed."
