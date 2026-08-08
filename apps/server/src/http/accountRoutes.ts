import { Router, type NextFunction, type Request, type Response } from "express";
import { prisma } from "../db/prisma.js";
import { readSessionFromRequest } from "../auth/cookies.js";
import type { SessionTokenPayload } from "../auth/jwt.js";
import { getUserAggregateStats, getUserGameHistory } from "../db/persistence.js";
import { asyncHandler } from "./asyncHandler.js";

/**
 * The exact shape both /profile/me and /profile/:username return — kept
 * identical on purpose so the web comparison page (§17.4f) can render
 * either side of a comparison with the same component, regardless of
 * whether it's "you" or someone else.
 */
async function buildPublicProfile(user: {
  id: string;
  username: string;
  displayName: string;
  createdAt: Date;
  ratingGlobal: number;
  ratingVillage: number;
  ratingWolf: number;
  ratingSolo: number;
  totalXp: number;
  level: number;
  mvpCount: number;
}) {
  const [stats, badgeCount] = await Promise.all([
    getUserAggregateStats(user.id),
    prisma.userBadge.count({ where: { userId: user.id } }),
  ]);
  return {
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      createdAt: user.createdAt.toISOString(),
    },
    stats,
    ratings: {
      global: user.ratingGlobal,
      village: user.ratingVillage,
      wolf: user.ratingWolf,
      solo: user.ratingSolo,
    },
    progression: {
      totalXp: user.totalXp,
      level: user.level,
      mvpCount: user.mvpCount,
    },
    badgeCount,
  };
}

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
accountApiRouter.get(
  "/profile/me",
  requireSession,
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.session!.userId } });
    if (!user) {
      res.status(401).json({ error: "Non connecté." });
      return;
    }
    res.json(await buildPublicProfile(user));
  }),
);

/**
 * Cahier de charge #2 §17.4f ("comparaison de profils"). Deliberately
 * public and keyed by username (not requireSession/userId): comparing your
 * own profile against a friend's shouldn't require THEM to be logged in
 * at that moment, and none of this data is private — it's the exact same
 * information already visible on /leaderboard for every account, section
 * 3's `displayName`/stats being explicitly described as "used for
 * classement/stats/profil" (see FEATURES.md's account-linkage table).
 */
accountApiRouter.get(
  "/profile/:username",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { username: req.params.username } });
    if (!user) {
      res.status(404).json({ error: "Aucun compte avec ce pseudo." });
      return;
    }
    res.json(await buildPublicProfile(user));
  }),
);

/** Paginated match history (section 5). `?limit=&offset=`, capped at 50 per page. */
accountApiRouter.get(
  "/history/me",
  requireSession,
  asyncHandler(async (req: AuthedRequest, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const history = await getUserGameHistory(req.session!.userId, { limit, offset });
    res.json(history);
  }),
);
