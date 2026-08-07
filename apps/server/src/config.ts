import "dotenv/config";

// Comma-separated list so you can allow both your local dev origin AND a
// tunnel URL (Tailscale Funnel, Cloudflare, ngrok, ...) at the same time
// without having to swap the env var back and forth between test/game night.
const corsOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const config = {
  port: Number(process.env.SERVER_PORT ?? 4000),
  corsOrigin: corsOrigins,
  databaseUrl: process.env.DATABASE_URL,
  auth: {
    // Dev-only fallback so `npm run dev` works out of the box; ALWAYS set a
    // real, random AUTH_JWT_SECRET in production (see deploy-manual.ps1 /
    // Terraform env config) — anyone who knows this value can forge a
    // session cookie for any account.
    jwtSecret: process.env.AUTH_JWT_SECRET ?? "dev-only-insecure-secret-change-me",
    cookieName: "lg_session",
    // 30 days.
    sessionTtlSeconds: 60 * 60 * 24 * 30,
    // Cross-origin cookies (a different registrable domain for the web app
    // vs the API, e.g. two separate custom domains in prod) need
    // SameSite=None + Secure=true. Same-site setups (same domain different
    // port/subdomain, or local dev) work fine with the Lax default. Flip
    // this via env once you know your prod domain layout.
    cookieSameSite: (process.env.AUTH_COOKIE_SAMESITE as "lax" | "none" | "strict" | undefined) ?? "lax",
    cookieSecure: process.env.AUTH_COOKIE_SECURE === "true",
  },
};
