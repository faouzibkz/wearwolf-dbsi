import { PrismaClient } from "@prisma/client";

/**
 * Postgres is used for persistence/resilience (surviving a server restart)
 * and for presets/history — never for live game logic, which always runs
 * against the in-memory GameEngine. If the DB is unreachable, persistence
 * calls are best-effort and swallowed (see persistence.ts) so a local game
 * night isn't blocked by a database hiccup.
 */
export const prisma = new PrismaClient();
