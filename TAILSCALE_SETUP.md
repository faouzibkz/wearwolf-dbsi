# Playing with friends over the internet (Tailscale Funnel)

This runs your laptop as the only "server" — friends just open a URL in their
browser, nobody else needs to install anything. Free, no account needed on
their end, and the URL stays the same every game night once you've set it up
once.

**Heads up:** every step below runs on your own Windows laptop (installing
software, signing into your own Tailscale account, running commands in your
own terminal). None of it can be done by Claude on your behalf — Tailscale
needs to run on the actual machine hosting the game, authenticated as you.
What Claude *has* already done: made the code/infra changes needed so this
works cleanly (see "What was changed in the repo" at the bottom). Everything
from here down is on you, and it's short.

**18 août 2026 update:** the app now sits behind a small reverse proxy
(`proxy/nginx.conf`, a new `proxy` service in `docker-compose.yml`) that
fronts both the web app and the game server on **one single port**. You now
only need **one** `tailscale funnel` command instead of two, and there's no
more `:8443` in any URL. This replaced the old two-port setup after real
game reports of "works on mobile data, can't connect on wifi" — many wifi
networks (guest/hotel/office/some home routers) block outbound traffic on
non-standard ports like 8443 while leaving 443 untouched; cellular data
essentially never blocks anything. Routing everything through one port
removes that failure mode entirely. If you set this app up before that date,
re-read this whole doc — the port-8443 instructions below no longer apply.

## One-time setup

1. **Install Tailscale**: https://tailscale.com/download — pick Windows, run
   the installer, sign in with any account (Google/Microsoft/GitHub/email).
   This is free for personal use (up to 6 devices/users on your network).

2. **Enable Funnel for your tailnet** (only needs doing once, ever). Open a
   terminal (PowerShell or Git Bash) and run:

   ```
   tailscale funnel 3000
   ```

   The first time you run this, it opens your browser and asks you to
   approve enabling Funnel + HTTPS certificates for your account. Approve
   it. It'll then print something like:

   ```
   Available on the internet:
   https://your-laptop-name.tailXXXXX.ts.net

   |-- / proxy http://127.0.0.1:3000
   ```

   **Write down that `https://your-laptop-name.tailXXXXX.ts.net` URL** — it's
   permanent for this device, you'll reuse it every time. Press `Ctrl+C` to
   stop this test run (you'll start it properly with `--bg` below).

## Every time you want to play

3. **Start the app** like normal, from the repo root:

   ```
   docker compose up -d --build
   ```

   This now also starts a `proxy` container (nginx) listening on port 3000
   — it's what actually serves both the web app and the game server/socket
   traffic from here on. The `web` and `server` containers themselves moved
   to ports 3001/4001, reachable directly on your own machine only, for
   debugging (see Troubleshooting below); nothing else needs to know about
   those two ports.

4. **Expose port 3000** with Tailscale (`--bg` = runs in the background, so
   it keeps working after you close the terminal):

   ```
   tailscale funnel --bg 3000
   ```

   That's it — one command, one port. Run `tailscale funnel status` anytime
   to confirm it's listed.

5. **Point the web app at its own public URL, and allow it through CORS.**
   Edit your `.env` file (create it from `.env.example` if you haven't) and
   set, using YOUR actual `tailXXXXX.ts.net` domain from step 2:

   ```
   NEXT_PUBLIC_SERVER_URL="https://your-laptop-name.tailXXXXX.ts.net"
   CORS_ORIGIN="http://localhost:3000,https://your-laptop-name.tailXXXXX.ts.net"
   ```

   No port on either line — same URL for the page and the game connection.
   (`CORS_ORIGIN` accepts a comma-separated list — see below — so you can
   keep testing on `localhost` at the same time as friends join over Funnel.)

6. **Apply the change.** The web app bakes `NEXT_PUBLIC_SERVER_URL` in at
   build time, so it needs a rebuild; the server reads `CORS_ORIGIN` at
   startup, so it just needs a restart; the proxy just needs to exist (no
   env vars of its own):

   ```
   docker compose up -d --build web
   docker compose restart server
   ```

7. **Share the join link**: `https://your-laptop-name.tailXXXXX.ts.net` —
   that's the same URL you'd put behind the admin dashboard's QR code. Send
   it to your friends; they open it in any browser, no install needed, and
   it works the same whether they're on wifi or mobile data. Keep the admin
   dashboard (`/admin`) to yourself.

## When you're done for the night

Either leave it running (it survives reboots since you used `--bg`, and
nobody can do anything without the link), or shut it off cleanly:

```
tailscale funnel --https=443 off
```

**Note on Tailscale CLI versions:** older Tailscale versions turned Funnel
off with `tailscale funnel 3000 off` — newer ones (confirmed 18 août 2026)
reject that with "the CLI for serve and funnel has changed" and want
`--https=<public port> off` instead (`--https=443` for the normal case,
`--https=8443` if you're still cleaning up an old pre-proxy setup that had
that second port on). If `off` errors, run `tailscale funnel status` first
— it prints the exact `off` command it wants, right under each active entry.

## Troubleshooting

- **Friends can load the page but can't connect / stuck on "Connexion à la
  partie…":** almost always means `NEXT_PUBLIC_SERVER_URL` wasn't rebuilt
  into the web image, or doesn't match the Funnel URL exactly (no port).
  Re-check steps 5–6.
- **CORS error in the browser console:** `CORS_ORIGIN` doesn't include the
  Funnel URL, or the server wasn't restarted after editing `.env`.
- **`tailscale funnel` says Funnel isn't enabled:** re-run the approval flow
  from step 2 — it needs to be approved from a browser once per tailnet.
- **Want to check the server or web app directly, bypassing the proxy?**
  They're still reachable on your own machine at `http://localhost:4001`
  (server — try `/health`) and `http://localhost:3001` (web). Neither is
  exposed to the internet; only port 3000 (the proxy) is ever funneled.
- **Someone still reports connection trouble on a specific wifi network
  after this update:** that network is likely blocking something beyond
  just "non-standard ports" (e.g. blocking WebSocket upgrades entirely, or
  the Funnel TLS handshake outright) — worth having them try mobile data
  once to confirm it's the network and not the app, same as before.
- **Want to know exactly what happened during a game (who did what, when,
  any disconnects)?** Every socket event — connects, disconnects (with
  Socket.IO's own reason: "transport close", "ping timeout", etc.), and
  every game action — is logged to `./logs/actions-YYYY-MM-DD.jsonl` at the
  repo root (one JSON object per line, one file per day). This is a plain
  folder on your own machine (bind-mounted from the `server` container —
  see docker-compose.yml), not something inside Docker's own log storage,
  so it survives `docker compose down` and rebuilds and you can just open
  it in a text editor or VS Code. A quick way to filter it:
  ```powershell
  Get-Content logs\actions-2026-08-18.jsonl | Select-String "ABCD"   # everything for game code ABCD
  Get-Content logs\actions-2026-08-18.jsonl | Select-String "disconnect"
  ```
- **A player confirms a night action/vote right after a reconnect — do they
  need to notice and re-click?** No, since 18 août 2026 (FEATURES.md §25).
  If the confirmation's server acknowledgment doesn't arrive in time — the
  common real case is a phone's connection blipping for a few seconds — the
  app retries automatically, up to twice more, waiting for the connection
  to come back if needed. The retry is safe to replay even if the original
  request actually landed (its ack just got lost): the server recognizes
  it's the same request and returns the same result instead of applying the
  action twice. Only if it's still failing after every retry does the
  player see an error and need to act. Look for `NIGHT_ACTION_SUBMIT`,
  `DAY_VOTE_CAST`, etc. in the action log (above) if you ever want to see
  this actually happen — a retried request shows up as two log lines for
  the same event close together, both tied to the same player.

## What was changed in the repo to support this

- **18 août 2026 — single-port proxy:** added `proxy/nginx.conf` and a new
  `proxy` service in `docker-compose.yml` that fronts both `web` and
  `server` on one port (host 3000 → proxy → `web:3000` or `server:4000`
  depending on the path). `web`/`server` moved to host ports 3001/4001 for
  direct local debugging only. This is what let the two separate Funnel
  ports (3000 + 8443) collapse into one.
- `apps/server/src/config.ts`: `CORS_ORIGIN` is parsed as a comma-separated
  list instead of a single origin, so you can allow both your local dev
  origin and a tunnel URL (Tailscale, Cloudflare, ngrok, ...) at the same
  time without swapping the env var back and forth.
