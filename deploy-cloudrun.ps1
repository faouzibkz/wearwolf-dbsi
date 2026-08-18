#
# Deploy Loup-Garou to Google Cloud Run -- no Terraform, just gcloud + docker.
# Run this from the repo root (same folder as docker-compose.yml), with your
# LOCAL docker-compose stack still up (`docker compose up -d`) since the data
# migration step (section 3) reads from your local `postgres` container.
#
# Requirements: gcloud CLI installed & logged in (gcloud auth login), Docker
# Desktop running, and your local docker-compose Postgres running with your
# real account/ranking data in it.
#
# What this creates in GCP (europe-west1, project lucid-burner-425912-m8):
#   - A small Cloud SQL Postgres instance (db-f1-micro, ~10-15 $/month)
#   - Three Cloud Run services: loupgarou-server, loupgarou-web, and
#     loupgarou-proxy (an nginx reverse proxy sitting in front of the other
#     two -- see proxy/nginx.cloudrun.conf.template). Share THIS proxy's URL
#     with players, not the web service's own URL: without it, web and
#     server sit on two different *.run.app domains, which makes the login
#     cookie a third-party cookie that mobile Safari blocks (desktop
#     tolerates it, which is why this only ever broke on phones). The proxy
#     puts everything back on one origin, exactly like the existing
#     Tailscale/docker-compose setup.
#   - The server runs with min=max=1 instance and CPU always allocated --
#     this app keeps live game state (who's connected, whose turn it is,
#     phase timers) in the server process's own memory, not in a shared
#     store. Cloud Run's normal autoscale-to-many-instances behavior would
#     silently split players across instances that don't share that state
#     (and scale-to-zero / CPU throttling would stop the background phase
#     timers from firing between requests). Pinning to exactly one
#     always-on instance keeps this identical to how it runs today in
#     docker-compose. This means it does NOT scale to zero -- it's billed
#     roughly like a small always-on VM, not "pay per request".
#   - The web service scales normally (it's stateless).
#
# Deliberately "Continue", NOT "Stop" -- gcloud's Windows wrapper (gcloud.ps1)
# writes routine, non-error status text to stderr constantly ("Updated
# property...", "Listing items under project...", and so on), and under
# $ErrorActionPreference = "Stop" every single one of those lines becomes a
# terminating PowerShell exception (a "NativeCommandError"), regardless of
# the command's actual exit code -- including commands that succeeded
# completely. That's what broke every gcloud call in this script so far,
# not the commands themselves. The fix is the standard one for wrapping
# noisy CLIs like gcloud/az/aws in PowerShell: leave $ErrorActionPreference
# alone (its default is "Continue") and treat $LASTEXITCODE as the ONLY
# source of truth for "did this actually fail" -- see Assert-LastExitCode
# below, called after every command where failing silently would be
# dangerous. Real PowerShell-level problems (a bad path, a missing file)
# still throw normally; `throw` itself always terminates regardless of
# $ErrorActionPreference.
$ErrorActionPreference = "Continue"
$PSNativeCommandUseErrorActionPreference = $false

function Assert-LastExitCode([string]$Message) {
    if ($LASTEXITCODE -ne 0) { throw "$Message (exit code $LASTEXITCODE)" }
}

# --- Config -- edit if anything differs from what you gave me ---
$ProjectId     = "lucid-burner-425912-m8"
$Region        = "europe-west1"
$ArHost        = "$Region-docker.pkg.dev"
$ArRepo        = "applications"
$ServerImage   = "$ArHost/$ProjectId/$ArRepo/loupgarou-server"
$WebImage      = "$ArHost/$ProjectId/$ArRepo/loupgarou-web"
$ProxyImage    = "$ArHost/$ProjectId/$ArRepo/loupgarou-proxy"

$SqlInstance   = "loupgarou-db"
$DbName        = "loupgarou"
$DbUser        = "loupgarou"

$ServerService = "loupgarou-server"
$WebService    = "loupgarou-web"
$ProxyService  = "loupgarou-proxy"

$Sha = (git rev-parse --short HEAD 2>$null)
if (-not $Sha) { $Sha = "manual-$(Get-Date -Format 'yyyyMMdd-HHmmss')" }
Write-Host "Deploying build tag: $Sha" -ForegroundColor Cyan

# =========================================================================
# 0. Project + APIs
# =========================================================================
Write-Host "`n--- 0. Project setup ---" -ForegroundColor Cyan
gcloud config set project $ProjectId
Assert-LastExitCode "Failed to set gcloud project to $ProjectId -- check gcloud auth login / project access"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com sqladmin.googleapis.com --quiet
Assert-LastExitCode "Failed to enable required APIs -- check that billing is enabled on this project"

# Your project was empty when you gave me this repo path, so it needs to be
# created too -- same "does it exist yet" pattern as everything else below.
# Deliberately using "list --filter" here, NOT "describe": describe on a
# single named resource errors out (404) when it's missing, and gcloud's
# Windows wrapper (gcloud.ps1) turns out to sometimes raise that as a
# terminating error even from inside a try/catch, unpredictably -- exactly
# what broke this check last run (it reported a repo that DOES exist as
# missing). "list --filter" has no such failure mode: an empty result set
# is just an empty result set, exit code 0, whether zero or many things
# match -- there's no "not found" error path to misfire in the first place.
$arRepoExists = [bool](gcloud artifacts repositories list --location=$Region --filter="name:*/$ArRepo" --format="value(name)" 2>$null)
if (-not $arRepoExists) {
    Write-Host "Creating Artifact Registry repo $ArRepo in $Region..." -ForegroundColor Yellow
    gcloud artifacts repositories create $ArRepo --repository-format=docker --location=$Region --quiet
    Assert-LastExitCode "Artifact Registry repo creation failed"
} else {
    Write-Host "Artifact Registry repo $ArRepo already exists, reusing it." -ForegroundColor Yellow
}

# =========================================================================
# 1. Cloud SQL -- Postgres instance (skip if it already exists)
# =========================================================================
Write-Host "`n--- 1. Cloud SQL ---" -ForegroundColor Cyan
# Same "list --filter" reasoning as the Artifact Registry check above --
# no single-resource "describe" call that can 404 and misfire a terminating
# error through gcloud's Windows wrapper.
$existing = [bool](gcloud sql instances list --filter="name:$SqlInstance" --format="value(name)" 2>$null)
if (-not $existing) {
    Write-Host "Creating Cloud SQL instance $SqlInstance (db-f1-micro)..." -ForegroundColor Yellow
    # --edition=ENTERPRISE is required here: this project's Cloud SQL
    # defaults to ENTERPRISE_PLUS, which does not support small/cheap
    # tiers like db-f1-micro at all (only bigger db-perf-optimized-N-*
    # machine types) -- forcing the classic ENTERPRISE edition is what
    # makes db-f1-micro a valid choice again.
    gcloud sql instances create $SqlInstance `
        --database-version=POSTGRES_16 `
        --edition=ENTERPRISE `
        --tier=db-f1-micro `
        --region=$Region `
        --storage-size=10GB `
        --storage-auto-increase
    Assert-LastExitCode "Cloud SQL instance creation failed"

    $DbPassword = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
    gcloud sql users create $DbUser --instance=$SqlInstance --password=$DbPassword
    Assert-LastExitCode "Cloud SQL user creation failed"
    gcloud sql databases create $DbName --instance=$SqlInstance
    Assert-LastExitCode "Cloud SQL database creation failed"

    $PasswordFile = Join-Path $PSScriptRoot ".cloudsql-db-password.txt"
    Set-Content -Path $PasswordFile -Value $DbPassword -NoNewline
    Write-Host "DB password saved to $PasswordFile (gitignored -- do NOT commit it). Keep it safe." -ForegroundColor Yellow
} else {
    Write-Host "Cloud SQL instance $SqlInstance already exists, reusing it." -ForegroundColor Yellow
    $PasswordFile = Join-Path $PSScriptRoot ".cloudsql-db-password.txt"
    if (-not (Test-Path $PasswordFile)) {
        throw "Instance exists but $PasswordFile is missing -- I can't recover the DB password. Reset it with:`n  gcloud sql users set-password $DbUser --instance=$SqlInstance --prompt-for-password"
    }
    $DbPassword = (Get-Content $PasswordFile -Raw).Trim()
}

$ConnectionName = gcloud sql instances describe $SqlInstance --format="value(connectionName)"
Assert-LastExitCode "Could not read Cloud SQL connection name"
$SqlPublicIp    = gcloud sql instances describe $SqlInstance --format="value(ipAddresses[0].ipAddress)"
Assert-LastExitCode "Could not read Cloud SQL public IP"
Write-Host "Cloud SQL connection name: $ConnectionName" -ForegroundColor Green

# =========================================================================
# 2. Migrate your real data: local docker-compose Postgres -> Cloud SQL
# =========================================================================
Write-Host "`n--- 2. Data migration (local -> Cloud SQL) ---" -ForegroundColor Cyan
$alreadyMigrated = Test-Path (Join-Path $PSScriptRoot ".cloudsql-migrated")
if ($alreadyMigrated) {
    Write-Host "Found .cloudsql-migrated marker -- skipping the dump/restore (delete that file to force a re-migration)." -ForegroundColor Yellow
} else {
    Write-Host "Saving a local backup copy (best-effort -- not used for the actual restore, so encoding quirks here don't matter)..." -ForegroundColor Yellow
    $DumpFile = Join-Path $PSScriptRoot "loupgarou-dump.sql"
    docker compose exec -T postgres pg_dump -U loupgarou -d loupgarou --no-owner --no-privileges | Out-File -FilePath $DumpFile -Encoding utf8
    Write-Host "Backup written to $DumpFile." -ForegroundColor Green

    Write-Host "Temporarily authorizing this machine's public IP on Cloud SQL..." -ForegroundColor Yellow
    try {
        $MyIp = (Invoke-RestMethod -Uri "https://api.ipify.org" -ErrorAction Stop).Trim()
    } catch {
        throw "Could not determine this machine's public IP (needed to temporarily open Cloud SQL for the migration): $_"
    }
    if ($MyIp -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { throw "Got back something that doesn't look like an IP address: '$MyIp'" }
    gcloud sql instances patch $SqlInstance --authorized-networks="$MyIp/32" --quiet
    Assert-LastExitCode "Failed to authorize this machine's IP on Cloud SQL"

    # Dump AND restore both run entirely inside the local postgres container's
    # own shell (pg_dump piped straight to psql, over TCP out to Cloud SQL's
    # public IP) -- deliberately NOT round-tripped through a PowerShell
    # variable/file first. PowerShell's text encoding (BOM handling in
    # particular) is not something you want anywhere near the middle of a
    # SQL dump containing UTF-8 nicknames (accents, etc.) -- a stray BOM byte
    # at the start is enough to make psql choke on the very first statement.
    Write-Host "Restoring into Cloud SQL (this can take a minute)..." -ForegroundColor Yellow
    $innerCmd = "pg_dump -U loupgarou -d loupgarou --no-owner --no-privileges | PGPASSWORD='$DbPassword' PGSSLMODE=require psql -h $SqlPublicIp -U $DbUser -d $DbName"
    docker compose exec -T postgres sh -c $innerCmd
    $restoreExitCode = $LASTEXITCODE
    # Revoke the temporary authorization no matter what -- never leave Cloud
    # SQL's public IP open to the internet just because the restore failed.
    Write-Host "Revoking the temporary authorization (Cloud Run connects via the private Cloud SQL connector, not the public IP)..." -ForegroundColor Yellow
    gcloud sql instances patch $SqlInstance --clear-authorized-networks --quiet

    if ($restoreExitCode -ne 0) { throw "Restore into Cloud SQL failed (exit code $restoreExitCode) -- see the psql output above. The temporary IP authorization has already been revoked." }

    New-Item -Path (Join-Path $PSScriptRoot ".cloudsql-migrated") -ItemType File -Force | Out-Null
    Write-Host "Migration done." -ForegroundColor Green
}

# =========================================================================
# 3. Grant Cloud Run's default service account access to Cloud SQL
# =========================================================================
Write-Host "`n--- 3. IAM ---" -ForegroundColor Cyan
$ProjectNumber = gcloud projects describe $ProjectId --format="value(projectNumber)"
Assert-LastExitCode "Could not read project number"
$ComputeSa = "$ProjectNumber-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding $ProjectId `
    --member="serviceAccount:$ComputeSa" `
    --role="roles/cloudsql.client" `
    --condition=None `
    --quiet | Out-Null
Assert-LastExitCode "Failed to grant Cloud SQL access to $ComputeSa"

# =========================================================================
# 4. Build + push the server image, deploy it, capture its URL
# =========================================================================
Write-Host "`n--- 4. Server: build, push, deploy ---" -ForegroundColor Cyan
gcloud auth configure-docker $ArHost --quiet

docker build -f apps/server/Dockerfile -t "${ServerImage}:$Sha" -t "${ServerImage}:latest" .
Assert-LastExitCode "server image build failed"
docker push "${ServerImage}:$Sha"
Assert-LastExitCode "server image push failed"
docker push "${ServerImage}:latest"
Assert-LastExitCode "server image push (latest tag) failed"

$AuthJwtSecret = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 48 | ForEach-Object { [char]$_ })
$DatabaseUrl = "postgresql://${DbUser}:${DbPassword}@localhost/${DbName}?host=/cloudsql/${ConnectionName}&schema=public"

# CORS_ORIGIN is a placeholder for now -- step 6 below patches it to the real
# web URL once that URL exists (Next.js bakes NEXT_PUBLIC_SERVER_URL in at
# BUILD time, so the server has to be deployed and known FIRST).
gcloud run deploy $ServerService `
    --image="${ServerImage}:$Sha" `
    --region=$Region `
    --platform=managed `
    --allow-unauthenticated `
    --port=4000 `
    --min-instances=1 `
    --max-instances=1 `
    --no-cpu-throttling `
    --timeout=3600 `
    --add-cloudsql-instances=$ConnectionName `
    --set-env-vars="SERVER_PORT=4000,DATABASE_URL=$DatabaseUrl,AUTH_JWT_SECRET=$AuthJwtSecret,AUTH_COOKIE_SAMESITE=none,AUTH_COOKIE_SECURE=true,CORS_ORIGIN=http://localhost:3000"
Assert-LastExitCode "server Cloud Run deploy failed"

$ServerUrl = gcloud run services describe $ServerService --region=$Region --format="value(status.url)"
Assert-LastExitCode "Could not read the server's Cloud Run URL"
Write-Host "Server deployed: $ServerUrl" -ForegroundColor Green
# No separate "prisma db push against Cloud SQL" step here on purpose: the
# pg_dump restored in step 2 already carries the FULL schema (CREATE TABLE
# etc.), not just data, so the DB is already correct on this first deploy.
# The Cloud Run image's own CMD does NOT auto-run `prisma db push` on boot
# (unlike docker-compose, which overrides the command to do so on every
# local start) -- see the reminder printed at the end of this script for
# exactly how to sync the schema by hand after any FUTURE schema.prisma
# change, before deploying the new server image.

# =========================================================================
# 5. Proxy, first pass: build + push + deploy just to learn its stable URL.
#    WEB_UPSTREAM is a placeholder for now -- step 7 below patches it to the
#    real web hostname once that exists (same "deploy now, patch the env var
#    later" trick as CORS_ORIGIN already used, except this time it's needed
#    on BOTH sides: web needs the proxy's URL baked in at BUILD time, and the
#    proxy needs web's URL, so one of the two has to come first).
# =========================================================================
Write-Host "`n--- 5. Proxy: build, push, deploy (pass 1 -- learn its URL) ---" -ForegroundColor Cyan
docker build -f proxy/Dockerfile.cloudrun -t "${ProxyImage}:$Sha" -t "${ProxyImage}:latest" .
Assert-LastExitCode "proxy image build failed"
docker push "${ProxyImage}:$Sha"
Assert-LastExitCode "proxy image push failed"
docker push "${ProxyImage}:latest"
Assert-LastExitCode "proxy image push (latest tag) failed"

$ServerHost = $ServerUrl -replace '^https?://', ''
gcloud run deploy $ProxyService `
    --image="${ProxyImage}:$Sha" `
    --region=$Region `
    --platform=managed `
    --allow-unauthenticated `
    --port=8080 `
    --timeout=3600 `
    --set-env-vars="SERVER_UPSTREAM=$ServerHost,WEB_UPSTREAM=web-not-deployed-yet.invalid"
Assert-LastExitCode "proxy Cloud Run deploy failed"

$ProxyUrl = gcloud run services describe $ProxyService --region=$Region --format="value(status.url)"
Assert-LastExitCode "Could not read the proxy's Cloud Run URL"
Write-Host "Proxy deployed (web upstream still a placeholder): $ProxyUrl" -ForegroundColor Green

# =========================================================================
# 6. Build + push the web image (bakes in the PROXY's URL, not the server's
#    -- the browser must only ever talk to one origin), deploy it
# =========================================================================
Write-Host "`n--- 6. Web: build, push, deploy ---" -ForegroundColor Cyan
docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_SERVER_URL="$ProxyUrl" -t "${WebImage}:$Sha" -t "${WebImage}:latest" .
Assert-LastExitCode "web image build failed"
docker push "${WebImage}:$Sha"
Assert-LastExitCode "web image push failed"
docker push "${WebImage}:latest"
Assert-LastExitCode "web image push (latest tag) failed"

gcloud run deploy $WebService `
    --image="${WebImage}:$Sha" `
    --region=$Region `
    --platform=managed `
    --allow-unauthenticated `
    --port=8080
Assert-LastExitCode "web Cloud Run deploy failed"

$WebUrl = gcloud run services describe $WebService --region=$Region --format="value(status.url)"
Assert-LastExitCode "Could not read the web app's Cloud Run URL"
Write-Host "Web deployed: $WebUrl" -ForegroundColor Green

# =========================================================================
# 7. Now that the web URL is known: point the proxy at it, and point the
#    server's CORS at the PROXY (that's the origin the browser actually
#    sees now, not the web service's own URL).
# =========================================================================
Write-Host "`n--- 7. Wiring proxy -> web, and CORS_ORIGIN -> proxy URL ---" -ForegroundColor Cyan
$WebHost = $WebUrl -replace '^https?://', ''
gcloud run services update $ProxyService `
    --region=$Region `
    --update-env-vars="WEB_UPSTREAM=$WebHost"
Assert-LastExitCode "Failed to update WEB_UPSTREAM on the proxy"

gcloud run services update $ServerService `
    --region=$Region `
    --update-env-vars="CORS_ORIGIN=$ProxyUrl"
Assert-LastExitCode "Failed to update CORS_ORIGIN on the server"

Write-Host "`n========================================================================" -ForegroundColor Green
Write-Host " Done." -ForegroundColor Green
Write-Host "   >>> Share THIS url with players: $ProxyUrl" -ForegroundColor White
Write-Host "   (web:    $WebUrl -- internal, do not share, cookies will not work on phones from here)" -ForegroundColor DarkGray
Write-Host "   (server: $ServerUrl -- internal, health check: $ServerUrl/health)" -ForegroundColor DarkGray
Write-Host "========================================================================" -ForegroundColor Green
Write-Host "`nGood to know:" -ForegroundColor Yellow
Write-Host " - The server runs 1 always-on instance (min=max=1, CPU always allocated)." -ForegroundColor Yellow
Write-Host "   That's intentional (see the comment at the top of this script) and" -ForegroundColor Yellow
Write-Host "   means it's billed like a small always-on VM, not scale-to-zero." -ForegroundColor Yellow
Write-Host " - Future schema.prisma changes: the Cloud Run image does NOT auto-run" -ForegroundColor Yellow
Write-Host "   'prisma db push' on boot (docker-compose does; Cloud Run doesn't)." -ForegroundColor Yellow
Write-Host "   Before deploying a new server image with a changed schema.prisma," -ForegroundColor Yellow
Write-Host "   run (after temporarily re-authorizing your IP, same as step 2):" -ForegroundColor Yellow
Write-Host "     gcloud sql instances patch $SqlInstance --authorized-networks=`"<your-ip>/32`"" -ForegroundColor White
Write-Host "     docker run --rm -e DATABASE_URL=`"postgresql://${DbUser}:<password>@<cloud-sql-ip>:5432/${DbName}?sslmode=require`" ${ServerImage}:latest npx prisma db push --skip-generate --accept-data-loss" -ForegroundColor White
Write-Host "     gcloud sql instances patch $SqlInstance --clear-authorized-networks" -ForegroundColor White
Write-Host " - DB password is in .cloudsql-db-password.txt (gitignored) -- back it up" -ForegroundColor Yellow
Write-Host "   somewhere safe; it's not recoverable from GCP, only resettable." -ForegroundColor Yellow
Write-Host " - Re-running this whole script is safe: it reuses the existing Cloud SQL" -ForegroundColor Yellow
Write-Host "   instance and skips the data migration (see .cloudsql-migrated)." -ForegroundColor Yellow
Write-Host " - Always share the PROXY url ($ProxyUrl) with players, never the web" -ForegroundColor Yellow
Write-Host "   service's own url. Web+server exist as separate Cloud Run services" -ForegroundColor Yellow
Write-Host "   for build/deploy reasons only -- the browser should never talk to" -ForegroundColor Yellow
Write-Host "   them directly, or the login cookie breaks on phones again." -ForegroundColor Yellow
