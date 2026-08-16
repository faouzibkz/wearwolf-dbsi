import type { EngineContext } from "../internalTypes";
import { processDeaths } from "./DeathQueue";

export interface DayVoteOutcome {
  eliminatedId: string | null;
  tie: boolean;
  tiedIds: string[];
  /**
   * True only when the vote is still unresolved and the one-and-only
   * defense-then-revote round must happen (a round 1 tie). Always false
   * afterwards — a round 2 tie is resolved immediately as "nobody dies",
   * not parked for another round. See resolveRepeatedTie.
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
  // Round 2+ (the one re-vote after a tie): the tied candidates being
  // voted on don't get to vote in their own re-vote at all — belt-and-
  // suspenders check, DayVoteQueue.buildVoteOrder already excludes them
  // from ever getting a turn in the first place.
  if (ctx.state.dayVote.round >= 2 && ctx.state.dayVote.tiedIds.includes(voterId)) {
    throw new Error("Les joueurs à égalité ne peuvent pas voter lors du second tour.");
  }
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
 * transition phases based on it (eliminate + move to NIGHT, or open
 * TIE_DEFENSE for the one round-1-tie re-vote).
 */
export function tallyDayVote(ctx: EngineContext): DayVoteOutcome {
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
      awaitingAnotherRound: true,
    };
  }

  return resolveRepeatedTie(ctx, topIds);
}

/**
 * Round 2 (the only re-vote — see DayVoteQueue.ts) tied again. This is a
 * hard-coded, non-configurable rule: nobody dies and the game moves
 * straight on to the next phase. There used to be a whole
 * REPEAT_DEFENSE/RANDOM/CHEF_DECIDES/ADMIN_DECIDES ruleset here; it's gone
 * — a persistent tie always means no elimination, full stop.
 */
function resolveRepeatedTie(ctx: EngineContext, topIds: string[]): DayVoteOutcome {
  resetDayVote(ctx);
  ctx.state.corbeauMarkedPlayerId = null;
  ctx.log("Égalité persistante — personne n'est éliminé.");
  return {
    eliminatedId: null,
    tie: true,
    tiedIds: topIds,
    awaitingAnotherRound: false,
  };
}

function resetDayVote(ctx: EngineContext): void {
  ctx.state.dayVote.votes.clear();
  ctx.state.dayVote.round = 1;
  ctx.state.dayVote.tiedIds = [];
}
