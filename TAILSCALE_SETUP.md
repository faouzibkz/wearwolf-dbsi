# Playing with friends over the internet (Tailscale Funnel)

This runs your laptop as the only "server" — friends just open a URL in their
browser, nobody else needs to install anything. Free, no account needed on
their end, and the URL stays the same every game night once you've set it up
once.

**Heads up:** every step below runs on your own Windows laptop (installing
software, signing into your own Tailscale account, running commands in your
own terminal). None of it can be done by Claude on your behalf — Tailscale
needs to run on the actual machine hosting the game, authenticated as you.
What Claude *has* already done: made the code changes needed so this works
cleanly (see "What was changed in the repo" at the bottom). Everything from
here down is on you, and it's short.

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

4. **Expose both ports** with Tailscale (`--bg` = runs in the background, so
   it keeps working after you close the terminal):

   ```
   tailscale funnel --bg 3000
   tailscale funnel --bg --https=8443 4000
   ```

   - Port `3000` (the web app) becomes `https://your-laptop-name.tailXXXXX.ts.net`
   - Port `4000` (the game server) becomes `https://your-laptop-name.tailXXXXX.ts.net:8443`

   Run `tailscale funnel status` anytime to confirm both are listed.

5. **Point the web app at the public server URL, and allow it through CORS.**
   Edit your `.env` file (create it from `.env.example` if you haven't) and
   set, using YOUR actual `tailXXXXX.ts.net` domain from step 2:

   ```
   NEXT_PUBLIC_SERVER_URL="https://your-laptop-name.tailXXXXX.ts.net:8443"
   CORS_ORIGIN="http://localhost:3000,https://your-laptop-name.tailXXXXX.ts.net"
   ```

   (`CORS_ORIGIN` now accepts a comma-separated list — see below — so you can
   keep testing on `localhost` at the same time as friends join over Funnel.)

6. **Apply the change.** The web app bakes `NEXT_PUBLIC_SERVER_URL` in at
   build time, so it needs a rebuild; the server reads `CORS_ORIGIN` at
   startup, so it just needs a restart:

   ```
   docker compose up -d --build web
   docker compose restart server
   ```

7. **Share the join link**: `https://your-laptop-name.tailXXXXX.ts.net` —
   that's the same URL you'd put behind the admin dashboard's QR code. Send
   it to your 10 friends; they open it in any browser, no install needed.
   Keep the admin dashboard (`/admin`) to yourself.

## When you're done for the night

Either leave it running (it survives reboots since you used `--bg`, and
nobody can do anything without the link), or shut it off cleanly:

```
tailscale funnel --https=8443 4000 off
tailscale funnel 3000 off
```

## Troubleshooting

- **Friends can load the page but can't connect / stuck on "Connexion à la
  partie…":** almost always means `NEXT_PUBLIC_SERVER_URL` wasn't rebuilt
  into the web image, or doesn't match the server's actual Funnel URL
  (including the `:8443`). Re-check step 5–6.
- **CORS error in the browser console:** `CORS_ORIGIN` doesn't include the
  Funnel URL, or the server wasn't restarted after editing `.env`.
- **`tailscale funnel` says Funnel isn't enabled:** re-run the approval flow
  from step 2 — it needs to be approved from a browser once per tailnet.

## What was changed in the repo to support this

- `apps/server/src/config.ts`: `CORS_ORIGIN` is now parsed as a
  comma-separated list instead of a single origin, so you can allow both
  your local dev origin and a tunnel URL (Tailscale, Cloudflare, ngrok, ...)
  at the same time without swapping the env var back and forth.
