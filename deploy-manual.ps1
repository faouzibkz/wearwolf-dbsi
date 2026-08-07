#
# Manual deploy: builds + pushes both Docker images to ECR and redeploys both
# ECS services, without going through the GitHub Actions pipeline at all.
# Run this from the repo root (same folder as docker-compose.yml).
#
# Requirements: Docker Desktop running, AWS CLI installed & configured with
# a profile that has the same permissions you've been using for terraform.
#
$ErrorActionPreference = "Stop"

$Region       = "eu-west-3"
$AccountId    = "442932344443"
$Registry     = "$AccountId.dkr.ecr.$Region.amazonaws.com"
$WebRepo      = "loupgarou-web"
$ServerRepo   = "loupgarou-server"
$Cluster      = "loupgarou-cluster"
$WebService   = "loupgarou-web"
$ServerService = "loupgarou-server"
$SiteUrl      = "https://loupgarou-dbsi.com"

# Tag images with the current commit so there's a real audit trail / rollback
# path, same as the pipeline does (falls back to "manual" if not in a git repo).
$Sha = (git rev-parse --short HEAD 2>$null)
if (-not $Sha) { $Sha = "manual-$(Get-Date -Format 'yyyyMMdd-HHmmss')" }
Write-Host "Deploying build tag: $Sha" -ForegroundColor Cyan

Write-Host "`n== Logging in to ECR ==" -ForegroundColor Cyan
# Piping through PowerShell's own pipeline can mangle the token (extra
# CR/LF, encoding changes) and Docker rejects it with a 400 rather than a
# clean 401 -- routing the pipe through cmd.exe avoids that entirely.
cmd /c "aws ecr get-login-password --region $Region | docker login --username AWS --password-stdin $Registry"
if ($LASTEXITCODE -ne 0) { throw "ECR login failed" }

Write-Host "`n== Building + pushing web image ==" -ForegroundColor Cyan
docker build -f apps/web/Dockerfile -t "$Registry/$WebRepo`:latest" -t "$Registry/$WebRepo`:$Sha" --build-arg NEXT_PUBLIC_SERVER_URL=$SiteUrl .
if ($LASTEXITCODE -ne 0) { throw "web image build failed" }
docker push "$Registry/$WebRepo`:latest"
docker push "$Registry/$WebRepo`:$Sha"

Write-Host "`n== Building + pushing server image ==" -ForegroundColor Cyan
docker build -f apps/server/Dockerfile -t "$Registry/$ServerRepo`:latest" -t "$Registry/$ServerRepo`:$Sha" .
if ($LASTEXITCODE -ne 0) { throw "server image build failed" }
docker push "$Registry/$ServerRepo`:latest"
docker push "$Registry/$ServerRepo`:$Sha"

function Deploy-Service($taskDefFamily, $image, $clusterName, $serviceName) {
    Write-Host "`n== Registering new task definition for $taskDefFamily ==" -ForegroundColor Cyan
    $taskDefJson = aws ecs describe-task-definition --task-definition $taskDefFamily --query taskDefinition --output json
    $taskDef = $taskDefJson | ConvertFrom-Json
    $taskDef.containerDefinitions[0].image = $image
    foreach ($p in @("taskDefinitionArn","revision","status","requiresAttributes","compatibilities","registeredAt","registeredBy")) {
        $taskDef.PSObject.Properties.Remove($p)
    }
    $tmpFile = [System.IO.Path]::GetTempFileName()
    # Out-File -Encoding utf8 writes a BOM on Windows PowerShell, which the
    # AWS CLI's JSON parser rejects outright ("Invalid JSON received") even
    # though the JSON is otherwise valid. WriteAllText defaults to BOM-less
    # UTF-8 regardless of PowerShell version.
    [System.IO.File]::WriteAllText($tmpFile, ($taskDef | ConvertTo-Json -Depth 30))
    $newArn = aws ecs register-task-definition --cli-input-json "file://$tmpFile" --query "taskDefinition.taskDefinitionArn" --output text
    Remove-Item $tmpFile
    if (-not $newArn) { throw "register-task-definition failed for $taskDefFamily" }

    Write-Host "== Updating service $serviceName -> $newArn (desired-count 1) ==" -ForegroundColor Cyan
    aws ecs update-service --cluster $clusterName --service $serviceName --task-definition $newArn --desired-count 1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "update-service failed for $serviceName" }
}

Deploy-Service -taskDefFamily $WebRepo    -image "$Registry/$WebRepo`:$Sha"    -clusterName $Cluster -serviceName $WebService
Deploy-Service -taskDefFamily $ServerRepo -image "$Registry/$ServerRepo`:$Sha" -clusterName $Cluster -serviceName $ServerService

Write-Host "`n== Waiting for both services to stabilize (this can take a couple minutes) ==" -ForegroundColor Cyan
aws ecs wait services-stable --cluster $Cluster --services $WebService $ServerService
Write-Host "`nDone. Both services deployed at commit $Sha and should be live at $SiteUrl" -ForegroundColor Green
