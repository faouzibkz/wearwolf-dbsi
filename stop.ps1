#
# Scales both Fargate services to 0 between game sessions, so you stop
# paying for compute while nobody's playing. Doesn't touch RDS or the ALB
# (those keep billing regardless - see README.md "Cost").
#
$ErrorActionPreference = "Stop"

$Region  = "eu-west-3"
$Cluster = "loupgarou-cluster"

Write-Host "== Scaling loupgarou-web and loupgarou-server to 0 ==" -ForegroundColor Cyan
aws ecs update-service --cluster $Cluster --service loupgarou-web --desired-count 0 --region $Region | Out-Null
aws ecs update-service --cluster $Cluster --service loupgarou-server --desired-count 0 --region $Region | Out-Null

Write-Host "Done - Fargate compute billing stops as soon as the tasks finish draining." -ForegroundColor Green
Write-Host "Run .\start.ps1 before your next game." -ForegroundColor Green
