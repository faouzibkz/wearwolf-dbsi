import type { FinalPlayerSummary, RoleId } from "@loupgarou/shared";

/**
 * Everything a performance-score formula gets to look at. Deliberately
 * narrow today: `packages/game-engine` doesn't yet keep a structured log of
 * in-game actions (who inspected whom, which potion was used and when,
 * etc.) — see FEATURES.md section 8 for the honest status of this
 * limitation. Extending this context with real per-action events, once the
 * engine exposes them, is the natural next step; nothing about the
 * registry pattern below needs to change to support that later.
 */
export interface PerformanceContext {
  summary: FinalPlayerSummary;
  /** How many full night phases this player was alive for — see apps/server's deriveStats.nightsSurvived(), computed once and passed in so this package never needs to parse a deathMoment string itself. */
  nightsSurvived: number;
  /** The game's total night count. */
  totalNights: number;
  /** Whether this player's team won the game. */
  won: boolean;
}

export type PerformanceScorer = (ctx: PerformanceContext) => number;

function clampScore(score: number): number {
  return Math.round(Math.max(0, Math.min(100, score)));
}

/**
 * The only scorer that actually exists today — every role currently falls
 * back to this (see PERFORMANCE_SCORERS below). Blends survival depth with
 * the win/loss outcome, weighted differently for SOLO-team roles: a solo
 * role (Alien today) is, by construction, on the losing side of most games
 * once Village/Loups resolves between themselves, so weighting outcome the
 * same as a team role would flatten every solo performance towards zero
 * regardless of how well they actually played — survival depth is the best
 * signal this data can offer for "how well did the solo player do".
 */
export function genericPerformanceScore(ctx: PerformanceContext): number {
  const survivalRatio =
    ctx.totalNights > 0 ? Math.min(1, ctx.nightsSurvived / ctx.totalNights) : ctx.summary.isAlive ? 1 : 0;
  const isSolo = ctx.summary.team === "SOLO";
  const survivalWeight = isSolo ? 0.85 : 0.6;
  const outcomeWeight = 1 - survivalWeight;
  const outcomeComponent = ctx.won ? 1 : 0;
  return clampScore((survivalRatio * survivalWeight + outcomeComponent * outcomeWeight) * 100);
}

/**
 * Per-role overrides (cahier de charge section 8: "Le système doit
 * permettre de créer un calcul personnalisé pour chaque rôle"). Empty
 * today — see the PerformanceContext doc comment above for why — but this
 * IS the extension point: adding a real Voyante-specific formula later is
 * exactly `VOYANTE: voyantePerformanceScore` on this object, nothing else
 * in this package or its callers needs to change. See
 * performance.test.ts's "custom scorer" test for a worked example of
 * exactly this.
 */
export const PERFORMANCE_SCORERS: Partial<Record<RoleId, PerformanceScorer>> = {};

export function computePerformanceScore(ctx: PerformanceContext): number {
  const scorer = PERFORMANCE_SCORERS[ctx.summary.roleId] ?? genericPerformanceScore;
  return scorer(ctx);
}
