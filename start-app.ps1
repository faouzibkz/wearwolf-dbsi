############################################################################
# Starts the app for a game night: builds/starts the Docker containers,
# then exposes them to the internet via Tailscale Funnel.
# See TAILSCALE_SETUP.md for the full explanation of each step.
#
# 18 août 2026: collapsed to a single funnel port. A `proxy` (nginx)
# container now fronts both the web app and the game server on port 3000 --
# no more separate :8443 for the server. See TAILSCALE_SETUP.md and
# FEATURES.md §22 for why (wifi networks blocking non-standard ports).
############################################################################

# Always run from the repo root, regardless of where this script is invoked from.
Set-Location $PSScriptRoot

Write-Host "Starting Docker containers..." -ForegroundColor Cyan
docker compose up -d --build

Write-Host "Exposing the app (web + game server, both via the proxy) on port 3000 via Tailscale Funnel..." -ForegroundColor Cyan
tailscale funnel --bg 3000

Write-Host ""
Write-Host "Done. Current Funnel status:" -ForegroundColor Green
tailscale funnel status

Write-Host ""
Write-Host "Share your https://<your-device>.tailXXXXX.ts.net URL with friends." -ForegroundColor Yellow
