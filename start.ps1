#
# Scales both Fargate services back to 1 before a game session, and waits
# until they're actually healthy behind the load balancer.
#
$ErrorActionPreference = "Stop"

$Region  = "eu-west-3"
$Cluster = "loupgarou-cluster"
$SiteUrl = "https://loupgarou-dbsi.com"

Write-Host "== Scaling loupgarou-web and loupgarou-server to 1 ==" -ForegroundColor Cyan
aws ecs update-service --cluster $Cluster --service loupgarou-web --desired-count 1 --region $Region | Out-Null
aws ecs update-service --cluster $Cluster --service loupgarou-server --desired-count 1 --region $Region | Out-Null

Write-Host "== Waiting for both services to become stable (usually 1-2 minutes) ==" -ForegroundColor Cyan
aws ecs wait services-stable --cluster $Cluster --services loupgarou-web loupgarou-server --region $Region

Write-Host "`nReady to play at $SiteUrl" -ForegroundColor Green
