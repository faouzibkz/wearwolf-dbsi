import { Router, type NextFunction, type Request, type Response } from "express";
import { prisma } from "../db/prisma.js";
import { readSessionFromRequest } from "../auth/cookies.js";
import type { SessionTokenPayload } from "../auth/jwt.js";
import { getUserAggregateStats, getUserGameHistory } from "../db/persistence.js";

interface AuthedRequest extends Request {
  session?: SessionTokenPayload;
}

function requireSession(req: AuthedRequest, res: Response, next: NextFunction): void {
  const session = readSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Non connecté." });
    return;
  }
  req.session = session;
  next();
}

export const accountApiRouter = Router();

/**
 * Profile (section 3) = account identity + the minimum stats set (section
 * 4), in one call — that's exactly what the profile page needs on load.
 */
accountApiRouter.get("/profile/me", requireSession, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.session!.userId } });
  if (!user) {
    res.status(401).json({ error: "Non connecté." });
    return;
  }
  const stats = await getUserAggregateStats(user.id);
  res.json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      createdAt: user.createdAt.toISOString(),
    },
    stats,
    // Phase 2b (cahier de charge sections 6/10) — see
    // apps/server/src/rating/applyRating.ts for how these evolve.
    ratings: {
      global: user.ratingGlobal,
      village: user.ratingVillage,
      wolf: user.ratingWolf,
      solo: user.ratingSolo,
    },
  });
});

/** Paginated match history (section 5). `?limit=&offset=`, capped at 50 per page. */
accountApiRouter.get("/history/me", requireSession, async (req: AuthedRequest, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const history = await getUserGameHistory(req.session!.userId, { limit, offset });
  res.json(history);
});
