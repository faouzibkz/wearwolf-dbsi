import { Router } from "express";
import { asyncHandler } from "./asyncHandler.js";
import { getLeaderboard, LEADERBOARD_CATEGORIES, type LeaderboardCategory } from "../db/persistence.js";

export const leaderboardApiRouter = Router();

function isLeaderboardCategory(value: unknown): value is LeaderboardCategory {
  return typeof value === "string" && (LEADERBOARD_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Cahier de charge #2 §17.4e. Deliberately public (no requireSession, unlike
 * profile/history/badges): a leaderboard of display names + ratings/XP/wins
 * is exactly the kind of thing every player at the table should be able to
 * see, logged in or not — same reasoning a scoreboard in any other game
 * would use.
 */
leaderboardApiRouter.get(
  "/leaderboard",
  asyncHandler(async (req, res) => {
    const category = req.query.category;
    if (!isLeaderboardCategory(category)) {
      res.status(400).json({ error: `category doit être l'une de : ${LEADERBOARD_CATEGORIES.join(", ")}` });
      return;
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const entries = await getLeaderboard(category, limit);
    res.json({ category, entries });
  }),
);
