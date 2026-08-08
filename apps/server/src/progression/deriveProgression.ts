/**
 * Pure XP/level math (cahier de charge section 11). Prisma-free, like
 * ../stats/deriveStats.ts and packages/rating — applyProgression.ts is the
 * only thing that touches a database, and it just calls these functions
 * and persists the result.
 *
 * "Le niveau est indépendant du rating" (spec) — this file has no idea
 * packages/rating even exists, and vice versa.
 */

/** Exact values from the cahier de charge's own example table. */
export const XP_PARTICIPATION = 20;
export const XP_VICTORY = 30;
export const XP_MVP = 15;

/** "Tous les 100 XP, le joueur gagne un niveau." Level 1 at 0-99 XP, level 2 at 100-199, etc. */
export const XP_PER_LEVEL = 100;

/**
 * Awarded once per game, immediately when it ends — participation always
 * applies (you played), the victory bonus only if your team won. Does NOT
 * include the MVP bonus: that's awarded separately, once the post-game MVP
 * vote finalizes (which can happen well after the game itself ends — see
 * computeMvpBonusXp and apps/server/src/mvp/*).
 */
export function computeBaseGameXp(won: boolean): number {
  return XP_PARTICIPATION + (won ? XP_VICTORY : 0);
}

/** Awarded once per MVP-winning player, whenever that game's vote finalizes. */
export function computeMvpBonusXp(): number {
  return XP_MVP;
}

/** Total XP -> current level. Never returns less than 1 (a fresh account starts at level 1 with 0 XP). */
export function computeLevel(totalXp: number): number {
  return Math.floor(Math.max(0, totalXp) / XP_PER_LEVEL) + 1;
}
