############################################################################
# Stops the app cleanly: turns off both Tailscale Funnels first (so nobody
# can reach the app while it's shutting down), then stops the containers.
############################################################################

Set-Location $PSScriptRoot

Write-Host "Clearing all Tailscale Funnel configuration..." -ForegroundColor Cyan
tailscale funnel reset

Write-Host "Stopping Docker containers..." -ForegroundColor Cyan
docker compose down

Write-Host ""
Write-Host "Done. Current Funnel status (should be empty):" -ForegroundColor Green
tailscale funnel status
