import type { FinalPlayerSummary, GameEvent, RoleId } from "@loupgarou/shared";
import { ROLE_METADATA } from "@loupgarou/shared";

/**
 * Everything a performance-score formula gets to look at. `events`/
 * `fullEventLog` are the payoff of cahier de charge #2 §17.4a's structured
 * event journal (packages/game-engine's GameEvent, re-exported from
 * @loupgarou/shared — see gameEvents.ts's doc comment for why it lives
 * there): real per-action outcomes instead of the survival+outcome-only
 * approximation this context used to be limited to.
 */
export interface PerformanceContext {
  summary: FinalPlayerSummary;
  /** How many full night phases this player was alive for — see apps/server's deriveStats.nightsSurvived(), computed once and passed in so this package never needs to parse a deathMoment string itself. */
  nightsSurvived: number;
  /** The game's total night count. */
  totalNights: number;
  /** Whether this player's team won the game. */
  won: boolean;
  /**
   * Every event THIS player personally caused (GameEvent.actorId === their
   * playerId) — the primary input for almost every per-role formula below:
   * each event already carries its own outcome (a `saved`/`correct`/
   * `killedWolf`/`result`/`outcome` field), so no formula needs to
   * cross-reference anything else to grade its own actions.
   */
  events: GameEvent[];
  /**
   * The full game's event log, unfiltered — only needed by formulas that
   * must check something that ISN'T one of this player's own events (e.g.
   * the Corbeau: did the player he marked actually get eliminated the next
   * day? That elimination is a collective DAY_VOTE_ELIMINATION event with
   * no actorId, so it can never appear in `events` above). Most formulas
   * only need `events`.
   */
  fullEventLog: GameEvent[];
}

export type PerformanceScorer = (ctx: PerformanceContext) => number;

function clampScore(score: number): number {
  return Math.round(Math.max(0, Math.min(100, score)));
}

/**
 * The fallback for every role with no formula registered below, and the
 * base every real per-role formula blends its own "usefulness" component
 * into (see blendUsefulness). Weighted differently for SOLO-team roles: a
 * solo role (Alien today) is, by construction, on the losing side of most
 * games once Village/Loups resolves between themselves, so weighting
 * outcome the same as a team role would flatten every solo performance
 * towards zero regardless of how well they actually played — survival
 * depth is the best signal this data can offer for "how well did the solo
 * player do".
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
 * Blends the generic survival+outcome score with a role-specific
 * "usefulness" ratio (0..1, e.g. "fraction of inspections that found a
 * wolf"). `usefulness: null` means the player never had the chance to take
 * the qualifying action at all this game (e.g. the Sorcière never used
 * either potion) — in that case the generic score is returned unchanged
 * rather than penalized for an action that was never available/necessary.
 */
function blendUsefulness(generic: number, usefulness: number | null, weight: number): number {
  if (usefulness === null) return generic;
  return clampScore(generic * (1 - weight) + usefulness * 100 * weight);
}

function eventsOfType<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

/** Fraction of inspections that revealed a wolf — finding a wolf is the whole point of the role. */
export function voyantePerformanceScore(ctx: PerformanceContext): number {
  const inspections = eventsOfType(ctx.events, "VOYANTE_INSPECT");
  const usefulness = inspections.length === 0 ? null : inspections.filter((e) => e.result === "LOUP").length / inspections.length;
  return blendUsefulness(genericPerformanceScore(ctx), usefulness, 0.3);
}

/** Fraction of protections that actually intercepted the wolves' attack. */
export function salvateurPerformanceScore(ctx: PerformanceContext): number {
  const protections = eventsOfType(ctx.events, "SALVATEUR_PROTECT");
  const usefulness = protections.length === 0 ? null : protections.filter((e) => e.saved).length / protections.length;
  return blendUsefulness(genericPerformanceScore(ctx), usefulness, 0.3);
}

/**
 * One usefulness point per heal used (a heal is always a save, by
 * construction — see GameEvent's SORCIERE_HEAL doc comment) plus one per
 * poison that actually killed a wolf, out of however many potions were
 * used this game (max 2: one heal, one poison, each one-shot per game).
 */
export function sorcierePerformanceScore(ctx: PerformanceContext): number {
  const heals = eventsOfType(ctx.events, "SORCIERE_HEAL");
  const poisons = eventsOfType(ctx.events, "SORCIERE_POISON");
  const used = heals.length + poisons.length;
  const usefulness = used === 0 ? null : (heals.length + poisons.filter((e) => e.killedWolf).length) / used;
  return blendUsefulness(genericPerformanceScore(ctx), usefulness, 0.3);
}

/**
 * Guessing correctly IS the Alien's entire game (his only source of
 * agency), so his guess accuracy is weighted more heavily than the other
 * roles' usefulness components.
 */
export function alienPerformanceScore(ctx: PerformanceContext): number {
  const guesses = eventsOfType(ctx.events, "ALIEN_GUESS");
  const usefulness = guesses.length === 0 ? null : guesses.filter((e) => e.correct).length / guesses.length;
  return blendUsefulness(genericPerformanceScore(ctx), usefulness, 0.4);
}

/**
 * The pack's kill-vote is a single COLLECTIVE decision (see
 * roles/wolfPack.ts) — there's no per-wolf dissent tracked, so every
 * still-a-wolf player in the game shares the same "did our attacks land"
 * ratio computed from the FULL event log, not just their own events (a
 * WOLF_KILL_ATTEMPT has no actorId at all). Used directly for LOUP_GAROU/
 * LOUP_BLANC, and as the base the Loup Vert's own guess bonus builds on.
 */
function wolfPackKillUsefulness(ctx: PerformanceContext): number | null {
  const attempts = eventsOfType(ctx.fullEventLog, "WOLF_KILL_ATTEMPT");
  if (attempts.length === 0) return null;
  return attempts.filter((e) => e.landed).length / attempts.length;
}

export function wolfPackPerformanceScore(ctx: PerformanceContext): number {
  return blendUsefulness(genericPerformanceScore(ctx), wolfPackKillUsefulness(ctx), 0.25);
}

/** Shares the pack's collective kill-usefulness, plus his own guess-accuracy bonus on top. */
export function loupVertPerformanceScore(ctx: PerformanceContext): number {
  const base = wolfPackPerformanceScore(ctx);
  const guesses = eventsOfType(ctx.events, "LOUP_VERT_GUESS");
  const guessUsefulness = guesses.length === 0 ? null : guesses.filter((e) => e.correct).length / guesses.length;
  return blendUsefulness(base, guessUsefulness, 0.3);
}

/** A revenge shot that lands on a wolf is a great outcome; on a villager, a costly own-goal. */
export function chasseurPerformanceScore(ctx: PerformanceContext): number {
  const shots = eventsOfType(ctx.events, "CHASSEUR_SHOT");
  const usefulness =
    shots.length === 0 ? null : shots.filter((e) => ROLE_METADATA[e.targetRoleId].team === "LOUPS").length / shots.length;
  return blendUsefulness(genericPerformanceScore(ctx), usefulness, 0.35);
}

/** Unmasking an actual wolf is the intended, high-value outcome; misfiring on a non-wolf costs two lives for nothing. */
export function barbiePerformanceScore(ctx: PerformanceContext): number {
  const reveals = eventsOfType(ctx.events, "BARBIE_REVEAL");
  const usefulness =
    reveals.length === 0 ? null : reveals.filter((e) => e.outcome === "WOLF_DIED_BARBIE_CHEF").length / reveals.length;
  return blendUsefulness(genericPerformanceScore(ctx), usefulness, 0.3);
}

/**
 * A mark is "useful" when the marked player was actually eliminated by the
 * next day's vote (the mark's whole effect is a hidden +2 tiebreak bonus in
 * that tally — see VoteManager.tallyDayVote). A mark placed on night N can
 * only ever affect the day-vote that immediately follows it, which is
 * always day N+1 in this engine's numbering (day 1 has no vote; night 1 is
 * followed by day 2's vote, and so on) — see eventLog.test.ts's day-vote
 * test for the same relationship confirmed end-to-end.
 */
export function corbeauPerformanceScore(ctx: PerformanceContext): number {
  const marks = eventsOfType(ctx.events, "CORBEAU_MARK");
  if (marks.length === 0) return genericPerformanceScore(ctx);
  const eliminations = eventsOfType(ctx.fullEventLog, "DAY_VOTE_ELIMINATION");
  const usefulMarks = marks.filter((m) =>
    eliminations.some((e) => e.day === m.night + 1 && e.targetId === m.targetId),
  );
  return blendUsefulness(genericPerformanceScore(ctx), usefulMarks.length / marks.length, 0.25);
}

/**
 * A landed shot on a wolf is the intended, high-value outcome (the target
 * dies, the Prêtre survives); a miss is the costliest single mistake in the
 * game — it's his own life, not a shared potion or a spendable "chance"
 * like the Alien's. Weighted heavily since — same as the Alien — this
 * one-shot choice is essentially his whole game.
 */
export function pretrePerformanceScore(ctx: PerformanceContext): number {
  const shots = eventsOfType(ctx.events, "PRETRE_SHOT");
  const usefulness = shots.length === 0 ? null : shots.filter((e) => e.hitWolf).length / shots.length;
  return blendUsefulness(genericPerformanceScore(ctx), usefulness, 0.4);
}

/**
 * Per-role overrides (cahier de charge section 8: "Le système doit
 * permettre de créer un calcul personnalisé pour chaque rôle"). Every role
 * with a night/day action whose outcome the event journal captures now has
 * a real formula above; VILLAGEOIS/MOWGLI have no qualifying action to
 * grade and fall back to the generic score, which is exactly correct for
 * them (a plain villager's whole game IS "survive, help vote correctly" —
 * already what genericPerformanceScore measures).
 */
export const PERFORMANCE_SCORERS: Partial<Record<RoleId, PerformanceScorer>> = {
  VOYANTE: voyantePerformanceScore,
  SALVATEUR: salvateurPerformanceScore,
  SORCIERE: sorcierePerformanceScore,
  ALIEN: alienPerformanceScore,
  LOUP_GAROU: wolfPackPerformanceScore,
  LOUP_BLANC: wolfPackPerformanceScore,
  LOUP_VERT: loupVertPerformanceScore,
  CHASSEUR: chasseurPerformanceScore,
  BARBIE: barbiePerformanceScore,
  CORBEAU: corbeauPerformanceScore,
  PRETRE: pretrePerformanceScore,
};

export function computePerformanceScore(ctx: PerformanceContext): number {
  const scorer = PERFORMANCE_SCORERS[ctx.summary.roleId] ?? genericPerformanceScore;
  return scorer(ctx);
}
