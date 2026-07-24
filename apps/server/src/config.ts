import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.SERVER_PORT ?? 4000),
  adminSecret: required("ADMIN_SECRET", "change-me-to-a-long-random-string"),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
  databaseUrl: process.env.DATABASE_URL,
};
