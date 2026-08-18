############################################################################
# Stops the app cleanly: turns off Tailscale Funnel first (so nobody can
# reach the app while it's shutting down), then stops the containers.
# `funnel reset` clears everything regardless of how many ports are
# funneled, so this didn't need to change with the 18 août 2026 move to a
# single port (see start-app.ps1 / TAILSCALE_SETUP.md).
############################################################################

Set-Location $PSScriptRoot

Write-Host "Clearing all Tailscale Funnel configuration..." -ForegroundColor Cyan
tailscale funnel reset

Write-Host "Stopping Docker containers..." -ForegroundColor Cyan
docker compose down

Write-Host ""
Write-Host "Done. Current Funnel status (should be empty):" -ForegroundColor Green
tailscale funnel status
