import http from "node:http";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { Server } from "socket.io";
import { DEFAULT_ROLE_DIFFICULTY } from "@loupgarou/rating";
import { config } from "./config.js";
import { registerSocketHandlers } from "./socket/handlers.js";
import { startIdleCleanupSweep } from "./socket/idleCleanup.js";
import { authRouter } from "./http/authRoutes.js";
import { accountApiRouter } from "./http/accountRoutes.js";
import { badgeApiRouter } from "./http/badgeRoutes.js";
import { leaderboardApiRouter } from "./http/leaderboardRoutes.js";
import { seedMissingRoleDifficulties } from "./rating/applyRating.js";

/**
 * Last-resort safety net for anything that reaches neither a route's own
 * try/catch nor the global Express error middleware below (e.g. an error
 * thrown outside a request, in a timer or a fire-and-forget promise like
 * finalizeGameHistory's callers in socket/handlers.ts). Node's default
 * behavior for both of these is to crash the process — logging instead
 * keeps every OTHER game in progress alive. This isn't a substitute for
 * fixing the underlying bug (still checked in CI/CloudWatch), it's just
 * the difference between "one thing broke" and "everyone's game just
 * disappeared" — see the 2026-08-08 incident (GET /me + a missing Prisma
 * migration crashed the whole server) this was added in response to.
 */
process.on("unhandledRejection", (reason) => {
  console.error("[process] unhandled promise rejection", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[process] uncaught exception", err);
});

const app = express();
// credentials: true is required for the session cookie to ride along on
// cross-origin requests from the web app (different port in dev, possibly
// a different subdomain in prod) — see auth/cookies.ts.
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

app.use("/api/auth", authRouter);
app.use("/api", accountApiRouter);
app.use("/api", badgeApiRouter);
app.use("/api", leaderboardApiRouter);

/**
 * Global HTTP error-handling middleware — must be registered last. Catches
 * whatever asyncHandler.ts forwards via next(err), plus anything a future
 * route lets slip through. Without this (and without asyncHandler on every
 * async route), an unexpected error — a DB hiccup, a missing migration, a
 * bug — becomes an unhandled rejection and takes down the ENTIRE process,
 * disconnecting every game in progress, not just the one request that
 * failed. That's exactly what happened on 2026-08-08 (GET /me + a missing
 * Prisma migration). One player's bad day should never end everyone else's
 * game.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[http] unhandled route error", err);
  if (!res.headersSent) {
    res.status(500).json({ error: "Erreur serveur, réessayez." });
  }
});

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: config.corsOrigin, methods: ["GET", "POST"], credentials: true },
});

registerSocketHandlers(io);
// Purges idle/abandoned LOBBY, ENDED, and stalled in-progress games from
// memory on a periodic sweep — see socket/idleCleanup.ts for thresholds.
startIdleCleanupSweep(io);

httpServer.listen(config.port, () => {
  console.log(`[loup-garou] server listening on http://localhost:${config.port}`);
});

// Best-effort, one-time-per-boot: makes sure every currently-known role has
// a RoleDifficulty row (section 7) without ever overwriting one someone's
// already tuned by hand. Never blocks the server from accepting
// connections — a DB hiccup here just means rating uses the code defaults
// (getRoleDifficulty's fallback) until the next successful boot.
seedMissingRoleDifficulties(DEFAULT_ROLE_DIFFICULTY).catch((err) => {
  console.error("[rating] failed to seed RoleDifficulty defaults on boot", err);
});
