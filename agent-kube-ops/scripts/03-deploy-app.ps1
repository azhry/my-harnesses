# Gate 3: Deploy app (PowerShell)

$ROOT_DIR = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
. "$ROOT_DIR\scripts\utils.ps1"

$WORKSPACE_DIR = Join-Path $ROOT_DIR "workspace"

# ---- Phase 1: Clone the remote git repo ----
Write-Output "=== Phase 1: Cloning app code ==="

if (-not $env:GIT_REPO) {
  Write-Output "FAIL: GIT_REPO environment variable is not set."
  exit 1
}

$repoName = Split-Path -Leaf $env:GIT_REPO
$repoName = $repoName -replace '\.git$', ''
$APP_DIR = Join-Path $WORKSPACE_DIR $repoName

if (Test-Path (Join-Path $APP_DIR ".git")) {
  Write-Output "Repo already cloned at $APP_DIR — pulling latest..."
  Push-Location $APP_DIR
  git pull
  Pop-Location
} else {
  Write-Output "Cloning $env:GIT_REPO into $APP_DIR..."
  New-Item -ItemType Directory -Path $WORKSPACE_DIR -Force *>$null
  git clone $env:GIT_REPO $APP_DIR
}

Write-Output "App source: $APP_DIR"

# ---- Phase 2: Discover how the app runs in production ----
Write-Output "=== Phase 2: Reading app code ==="
Push-Location $APP_DIR

$runtimeFiles = @("package.json", "requirements.txt", "Cargo.toml", "go.mod", "pom.xml", "build.gradle")
$found = $false
foreach ($f in $runtimeFiles) {
  if (Test-Path $f) { $found = $true; break }
}
if (-not $found) {
  Write-Output "WARN: No recognized runtime file found. Agent must inspect the code manually."
}
Pop-Location

# ---- Phase 3: Build and push to ECR ----
Write-Output "=== Phase 3: Building and pushing to ECR ==="
$ecrUri = Read-Infra -Key "ecr_repository_uri"
$region = Read-Infra -Key "region"

Push-Location $APP_DIR
$gitHash = git rev-parse --short HEAD 2>$null
Pop-Location
$imageTag = if ($env:IMAGE_TAG) { $env:IMAGE_TAG } elseif ($gitHash) { $gitHash } else { [DateTime]::UtcNow.ToString("yyyyMMddHHmmss") }
$fullImage = "${ecrUri}:${imageTag}"

Write-Output "Image: $fullImage"

aws ecr get-login-password --region $region | docker login --username AWS --password-stdin $ecrUri *>$null

$dockerfile = Join-Path $APP_DIR "Dockerfile"
if (-not (Test-Path $dockerfile)) {
  Write-Output "FAIL: No Dockerfile found in $APP_DIR. Agent must create one first."
  exit 1
}

docker build -t $fullImage $APP_DIR
docker push $fullImage

# ---- Phase 4: Create and apply k8s manifests ----
Write-Output "=== Phase 4: Applying Kubernetes manifests ==="
$infraNamespace = Read-Infra -Key "namespace"
$namespace = if ($env:NAMESPACE) { $env:NAMESPACE } elseif ($infraNamespace) { $infraNamespace } else { "default" }
$manifestDir = Join-Path (Join-Path $ROOT_DIR "templates") "k8s"

if (Test-Path $manifestDir) {
  Get-ChildItem $manifestDir -Filter "*.yaml" | ForEach-Object {
    $content = Get-Content $_.FullName -Raw
    $content = $content -replace '__IMAGE__', $fullImage
    $content = $content -replace '__NAMESPACE__', $namespace
    $content | kubectl apply -f -
  }
} else {
  Write-Output "FAIL: No k8s manifest templates found. Agent must create them first."
  exit 1
}

# ---- Phase 5: Record deployment state ----
Write-Output "=== Phase 5: Recording deployment state ==="
$state = @{
  git_repo   = $env:GIT_REPO
  git_hash   = $gitHash
  image      = $fullImage
  namespace  = $namespace
  deployed_at = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
  status     = "deployed"
}
$state | ConvertTo-Json | Set-Content (Join-Path $ROOT_DIR "state" "current-deployment.json")

Write-Output "PASS: Deployment submitted. Run scripts\04-healthcheck.ps1 to verify."
exit 0
