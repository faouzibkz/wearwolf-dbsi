############################################################################
# Starts the app for a game night: builds/starts the Docker containers,
# then exposes them to the internet via Tailscale Funnel.
# See TAILSCALE_SETUP.md for the full explanation of each step.
############################################################################

# Always run from the repo root, regardless of where this script is invoked from.
Set-Location $PSScriptRoot

Write-Host "Starting Docker containers..." -ForegroundColor Cyan
docker compose up -d --build

Write-Host "Exposing web app (port 3000) via Tailscale Funnel..." -ForegroundColor Cyan
tailscale funnel --bg 3000

Write-Host "Exposing game server (port 4000) via Tailscale Funnel..." -ForegroundColor Cyan
tailscale funnel --bg --https=8443 4000

Write-Host ""
Write-Host "Done. Current Funnel status:" -ForegroundColor Green
tailscale funnel status

Write-Host ""
Write-Host "Share your https://<your-device>.tailXXXXX.ts.net URL with friends." -ForegroundColor Yellow
