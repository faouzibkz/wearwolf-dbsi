import type { Team } from "@loupgarou/shared";

export interface RatingInputs {
  currentRating: number;
  /**
   * Cahier de charge section 9's "rating moyen de la partie" — literally
   * the average GLOBAL rating of every account-linked participant in the
   * game (including this player). Deliberately game-wide rather than
   * per-opponent-team: the spec's own wording is "rating moyen de la
   * partie", not "rating moyen de l'équipe adverse", and a game-wide
   * average is simpler to reason about and doesn't require deciding how to
   * treat the SOLO role's simultaneous opposition to both other teams.
   */
  avgGameRating: number;
  won: boolean;
  draw?: boolean;
  /** 0-100, from computePerformanceScore(). */
  performanceScore: number;
  /** From getRoleDifficulty(). */
  roleCoefficient: number;
  /** Standard Elo starting point; exposed so it can be tuned later without touching the formula itself. */
  kFactor?: number;
}

export interface RatingResult {
  delta: number;
  newRating: number;
}

const DEFAULT_K_FACTOR = 32;

/**
 * Elo-inspired rating update. Not textbook Elo — deliberately blends a
 * standard Elo expected-score term with an explicit performance
 * bonus/penalty, so the four terms cahier de charge section 9 names
 * (Résultat + Performance + Coefficient du rôle + Rating moyen de la
 * partie) are all literally present:
 *
 *   resultComponent      <- Résultat (actualScore) vs. Rating moyen de la partie (avgGameRating)
 *   performanceComponent <- Performance (performanceScore, centered on 50 = neutral)
 *   roleCoefficient       <- Coefficient du rôle, applied multiplicatively to the whole delta
 *
 * This is what makes the two examples in the spec possible: a strong
 * performance can add a few points even in a loss (performanceComponent
 * partially offsets a negative resultComponent), and a weak one can cost a
 * few points even in a win (performanceComponent partially offsets a
 * positive resultComponent).
 */
export function computeRatingDelta(inputs: RatingInputs): RatingResult {
  const kFactor = inputs.kFactor ?? DEFAULT_K_FACTOR;
  const actualScore = inputs.draw ? 0.5 : inputs.won ? 1 : 0;
  const expectedScore = 1 / (1 + Math.pow(10, (inputs.avgGameRating - inputs.currentRating) / 400));
  const resultComponent = kFactor * (actualScore - expectedScore);

  // performanceScore is 0-100; 50 is "average" and contributes nothing,
  // above/below shifts the delta by up to +/- half of kFactor either way.
  const performanceComponent = ((inputs.performanceScore - 50) / 50) * (kFactor / 2);

  const delta = Math.round((resultComponent + performanceComponent) * inputs.roleCoefficient);
  return { delta, newRating: Math.max(0, inputs.currentRating + delta) };
}

/** The four rating "scopes" from section 10 — Global always updates; exactly one of the other three joins it, depending on which team this player was on for this particular game. */
export type SpecializedRatingScope = "VILLAGE" | "WOLF" | "SOLO";

export function specializedScopeForTeam(team: Team): SpecializedRatingScope {
  switch (team) {
    case "VILLAGE":
      return "VILLAGE";
    case "LOUPS":
      return "WOLF";
    case "SOLO":
      return "SOLO";
  }
}

export const INITIAL_RATING = 1000;
