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
  // The double-vote bonus only applies to round 1 of a day vote. Once a tie
  // sends things to TIE_DEFENSE and a re-vote (round 2, 3, ...), every vote
  // — including the Chef's — counts equally: the bonus's job is to help
  // avoid ties in the first place, not to keep tipping the scales once an
  // actual tie-break is already underway.
  const bonusActive = ctx.state.dayVote.round === 1 && aliveCount > ctx.state.config.chefVoteBonusThreshold;
  return voter.isChef && bonusActive ? 2 : 1;
}

/**
 * Live, weighted tally of the CURRENT round's votes (targetId -> total
 * weight), reflecting the Chef's double-vote bonus exactly like the real
 * tally does. Deliberately excludes the secret Corbeau bonus (only applied
 * at final tally time) so the live view never tips off that a mark was
 * placed. Used to drive the public live-vote display — never touches game
 * state, safe to call at any time during DAY_VOTE.
 */
export function computeLiveVoteTally(ctx: EngineContext): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const [voterId, targetId] of ctx.state.dayVote.votes.entries()) {
    tally[targetId] = (tally[targetId] ?? 0) + chefVoteWeight(ctx, voterId);
  }
  return tally;
}

export function castDayVote(ctx: EngineContext, voterId: string, targetId: string): void {
  const voter = ctx.getPlayer(voterId);
  if (!voter.isAlive) throw new Error("Un joueur mort ne peut pas voter.");
  // The vote is now a per-player turn queue (DayVoteQueue.ts), not a free-
  // for-all — only whoever's turn it currently is may cast right now.
  if (ctx.state.dayVoteQueue) {
    const currentVoterId = ctx.state.dayVoteQueue.order[ctx.state.dayVoteQueue.currentSpeakerIndex] ?? null;
    if (currentVoterId !== voterId) {
      throw new Error("Ce n'est pas votre tour de voter.");
    }
  }
  // One vote per player per round, locked — prevents last-second bandwagon
  // flips and rage-clicking. A player DOES get a fresh vote each new round
  // (dayVote.votes is cleared whenever a round advances — see tallyDayVote
  // and resetDayVote below), so this only blocks changing your mind within
  // the SAME round, not voting again after a tie reopens the ballot.
  if (ctx.state.dayVote.votes.has(voterId)) {
    throw new Error("Vous avez déjà voté — votre vote est verrouillé pour ce tour.");
  }
  const target = ctx.getPlayer(targetId);
  const eligibleIds =
    ctx.state.dayVote.round === 1
      ? ctx.getAlivePlayers().map((p) => p.id)
      : ctx.state.dayVote.tiedIds;
  if (!eligibleIds.includes(target.id)) throw new Error("Cible de vote invalide.");
  ctx.state.dayVote.votes.set(voterId, targetId);
  ctx.recordEvent({
    type: "DAY_VOTE_CAST",
    day: ctx.state.dayNumber,
    round: ctx.state.dayVote.round,
    actorId: voterId,
    targetId,
  });
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
    ctx.recordEvent({
      type: "DAY_VOTE_ELIMINATION",
      day: ctx.state.dayNumber,
      round: dayVote.round,
      targetId: eliminatedId,
    });
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
    // Round 2 starts with a clean ballot. Without this, a tied player who
    // simply doesn't recast a vote keeps their stale round-1 entry, which
    // then gets silently counted again in the round-2 tally — effectively
    // carrying an old vote over into a "fresh" re-vote nobody asked for.
    dayVote.votes.clear();
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
      ctx.recordEvent({
        type: "DAY_VOTE_ELIMINATION",
        day: ctx.state.dayNumber,
        round: dayVote.round,
        targetId: chosen,
      });
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
    ctx.recordEvent({
      type: "DAY_VOTE_ELIMINATION",
      day: ctx.state.dayNumber,
      round: ctx.state.dayVote.round,
      targetId,
    });
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
