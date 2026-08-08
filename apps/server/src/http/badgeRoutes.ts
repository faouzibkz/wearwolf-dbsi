import { Router, type NextFunction, type Request, type Response } from "express";
import { prisma } from "../db/prisma.js";
import { readSessionFromRequest } from "../auth/cookies.js";
import type { SessionTokenPayload } from "../auth/jwt.js";
import { asyncHandler } from "./asyncHandler.js";
import { BADGE_REGISTRY } from "../badges/deriveBadges.js";

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

export const badgeApiRouter = Router();

/**
 * Cahier de charge #2 §17.4c/d — everything the achievements page (§17.4d)
 * needs in one call: unlocked badges (full name/description, even the
 * secret ones — a secret badge is only hidden BEFORE it's earned) plus the
 * list of still-locked NON-secret badges (so the page can show "8 / 16"
 * progress with what's left to do) and a count of how many secret badges
 * remain (shown as "???" placeholders, never their name/description, or
 * they wouldn't be secret). Badge metadata itself always comes from
 * BADGE_REGISTRY (code), never a DB table — see deriveBadges.ts's doc
 * comment.
 */
badgeApiRouter.get(
  "/badges/me",
  requireSession,
  asyncHandler(async (req: AuthedRequest, res) => {
    const unlocked = await prisma.userBadge.findMany({
      where: { userId: req.session!.userId },
      orderBy: { unlockedAt: "desc" },
    });
    const unlockedIds = new Set(unlocked.map((b: { badgeId: string }) => b.badgeId));

    const unlockedBadges = unlocked
      .map((row: { badgeId: string; unlockedAt: Date }) => {
        const def = BADGE_REGISTRY.find((b) => b.id === row.badgeId);
        if (!def) return null; // a badge that existed once but was removed from the registry — skip rather than crash
        return { id: def.id, name: def.name, description: def.description, secret: def.secret, unlockedAt: row.unlockedAt.toISOString() };
      })
      .filter((b: unknown): b is NonNullable<typeof b> => b !== null);

    const lockedVisible = BADGE_REGISTRY.filter((b) => !b.secret && !unlockedIds.has(b.id)).map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description,
    }));
    const secretLockedCount = BADGE_REGISTRY.filter((b) => b.secret && !unlockedIds.has(b.id)).length;

    res.json({
      unlocked: unlockedBadges,
      locked: lockedVisible,
      secretLockedCount,
      totalBadgeCount: BADGE_REGISTRY.length,
    });
  }),
);
