import type { TieResolutionRule } from "@loupgarou/shared";
import type { EngineContext } from "../internalTypes";
import { shuffle } from "../util/shuffle";
import { processDeaths } from "./DeathQueue";

export interface DayVoteOutcome {
  eliminatedId: string | null;
  tie: boolean;
  tiedIds: string[];
  needsManualResolution: boolean;
  /**
   * True only when the vote is still unresolved and another
   * defense-then-revote round must happen (round 1 tie, or a repeated tie
   * under the REPEAT_DEFENSE rule). False for every other outcome —
   * including NO_ELIMINATION/RANDOM ties and manual-resolution parking —
   * because those have either already finished or are waiting on a single
   * decision rather than another full defense round.
   */
  awaitingAnotherRound: boolean;
}

function chefVoteWeight(ctx: EngineContext, voterId: string): number {
  const voter = ctx.getPlayer(voterId);
  const aliveCount = ctx.getAlivePlayers().length;
  const bonusActive = aliveCount > ctx.state.config.chefVoteBonusThreshold;
  return voter.isChef && bonusActive ? 2 : 1;
}

export function castDayVote(ctx: EngineContext, voterId: string, targetId: string): void {
  const voter = ctx.getPlayer(voterId);
  if (!voter.isAlive) throw new Error("Un joueur mort ne peut pas voter.");
  const target = ctx.getPlayer(targetId);
  const eligibleIds =
    ctx.state.dayVote.round === 1
      ? ctx.getAlivePlayers().map((p) => p.id)
      : ctx.state.dayVote.tiedIds;
  if (!eligibleIds.includes(target.id)) throw new Error("Cible de vote invalide.");
  ctx.state.dayVote.votes.set(voterId, targetId);
}

/**
 * Tally the current round. Returns the outcome; GameEngine decides how to
 * transition phases based on it (eliminate + move to NIGHT, open
 * TIE_DEFENSE, or pause awaiting admin/chef manual resolution).
 */
export function tallyDayVote(
  ctx: EngineContext,
  rng: () => number = Math.random,
): DayVoteOutcome {
  const dayVote = ctx.state.dayVote;
  const scores = new Map<string, number>();

  const eligibleIds =
    dayVote.round === 1 ? ctx.getAlivePlayers().map((p) => p.id) : dayVote.tiedIds;
  for (const id of eligibleIds) scores.set(id, 0);

  for (const [voterId, targetId] of dayVote.votes.entries()) {
    if (!scores.has(targetId)) continue;
    scores.set(targetId, (scores.get(targetId) ?? 0) + chefVoteWeight(ctx, voterId));
  }

  if (dayVote.round === 1 && ctx.state.corbeauMarkedPlayerId && scores.has(ctx.state.corbeauMarkedPlayerId)) {
    const id = ctx.state.corbeauMarkedPlayerId;
    scores.set(id, (scores.get(id) ?? 0) + 2);
  }

  let best = -1;
  for (const score of scores.values()) if (score > best) best = score;
  const topIds = [...scores.entries()].filter(([, s]) => s === best).map(([id]) => id);

  if (topIds.length === 1) {
    const eliminatedId = topIds[0]!;
    processDeaths(ctx, [{ playerId: eliminatedId, cause: "VOTE_ELIMINATION" }]);
    resetDayVote(ctx);
    ctx.state.corbeauMarkedPlayerId = null;
    return {
      eliminatedId,
      tie: false,
      tiedIds: [],
      needsManualResolution: false,
      awaitingAnotherRound: false,
    };
  }

  // Tie.
  if (dayVote.round === 1) {
    dayVote.tiedIds = topIds;
    dayVote.round = 2;
    return {
      eliminatedId: null,
      tie: true,
      tiedIds: topIds,
      needsManualResolution: false,
      awaitingAnotherRound: true,
    };
  }

  return resolveRepeatedTie(ctx, topIds, rng);
}

function resolveRepeatedTie(
  ctx: EngineContext,
  topIds: string[],
  rng: () => number,
): DayVoteOutcome {
  const rule: TieResolutionRule = ctx.state.config.tieResolutionRule;
  const dayVote = ctx.state.dayVote;

  switch (rule) {
    case "REPEAT_DEFENSE":
      dayVote.tiedIds = topIds;
      dayVote.round += 1;
      dayVote.votes.clear();
      return {
        eliminatedId: null,
        tie: true,
        tiedIds: topIds,
        needsManualResolution: false,
        awaitingAnotherRound: true,
      };
    case "NO_ELIMINATION":
      resetDayVote(ctx);
      ctx.state.corbeauMarkedPlayerId = null;
      ctx.log("Égalité persistante — personne n'est éliminé (règle : pas d'élimination).");
      return {
        eliminatedId: null,
        tie: true,
        tiedIds: topIds,
        needsManualResolution: false,
        awaitingAnotherRound: false,
      };
    case "RANDOM": {
      const chosen = shuffle(topIds, rng)[0]!;
      processDeaths(ctx, [{ playerId: chosen, cause: "VOTE_ELIMINATION" }]);
      resetDayVote(ctx);
      ctx.state.corbeauMarkedPlayerId = null;
      ctx.log("Égalité persistante — élimination tirée au sort.");
      return {
        eliminatedId: chosen,
        tie: true,
        tiedIds: topIds,
        needsManualResolution: false,
        awaitingAnotherRound: false,
      };
    }
    case "CHEF_DECIDES":
    case "ADMIN_DECIDES":
      dayVote.tiedIds = topIds;
      ctx.state.pendingTieResolutionRule = rule;
      return {
        eliminatedId: null,
        tie: true,
        tiedIds: topIds,
        needsManualResolution: true,
        awaitingAnotherRound: false,
      };
    default:
      resetDayVote(ctx);
      return {
        eliminatedId: null,
        tie: true,
        tiedIds: topIds,
        needsManualResolution: false,
        awaitingAnotherRound: false,
      };
  }
}

/** Used for CHEF_DECIDES / ADMIN_DECIDES: apply the manually chosen target (or null = no elimination). */
export function resolveTieManually(ctx: EngineContext, targetId: string | null): DayVoteOutcome {
  if (targetId) {
    if (!ctx.state.dayVote.tiedIds.includes(targetId)) {
      throw new Error("La cible doit faire partie des joueurs à égalité.");
    }
    processDeaths(ctx, [{ playerId: targetId, cause: "VOTE_ELIMINATION" }]);
  }
  const tiedIds = ctx.state.dayVote.tiedIds;
  resetDayVote(ctx);
  ctx.state.corbeauMarkedPlayerId = null;
  ctx.state.pendingTieResolutionRule = null;
  return {
    eliminatedId: targetId,
    tie: true,
    tiedIds,
    needsManualResolution: false,
    awaitingAnotherRound: false,
  };
}

function resetDayVote(ctx: EngineContext): void {
  ctx.state.dayVote.votes.clear();
  ctx.state.dayVote.round = 1;
  ctx.state.dayVote.tiedIds = [];
}
