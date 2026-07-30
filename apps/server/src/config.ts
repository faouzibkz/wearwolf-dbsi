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
};
