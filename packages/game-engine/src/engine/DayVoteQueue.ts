import type { EngineContext } from "../internalTypes";
import * as SpeakerQueue from "./SpeakerQueue";

/**
 * DAY_VOTE used to be a simultaneous open ballot: everyone could vote
 * whenever they wanted, in whatever order. This module turns it into a
 * per-player turn queue instead — one player votes (or times out) at a
 * time, in the SAME order as today's discussion (see DayDiscussion.ts),
 * with the Chef always going last regardless of where they landed in that
 * order.
 *
 * Round 1 (or any fresh, untied vote): the queue is every alive player —
 * this is who gets a TURN TO VOTE, which is NOT the same thing as
 * `dayVote.tiedIds` (who you're allowed to VOTE FOR), a concept that
 * doesn't exist yet in round 1.
 *
 * Round 2 (the one and only re-vote, held after a round-1 tie's defense
 * speeches): the previously-tied candidates no longer get a turn at all —
 * only the rest of the village votes, and only for the tied candidates
 * (that target-eligibility check lives in VoteManager.castDayVote). If
 * this second round ties again, nobody dies — see
 * VoteManager.resolveRepeatedTie — the game simply moves on to the next
 * phase. There is no round 3.
 */
function buildVoteOrder(ctx: EngineContext): string[] {
  const chefId = ctx.state.chef.electedId;
  // dayDiscussion.order has the Chef twice (speaks first AND last — see
  // DayDiscussion.ts) and only includes players who were alive when that
  // day's discussion started, which is exactly the set of voters we want.
  // De-dupe down to each player once, in their discussion-order position,
  // then move the Chef specifically to the end.
  const discussionOrder = ctx.state.dayDiscussion?.order ?? ctx.getAlivePlayers().map((p) => p.id);
  const seen = new Set<string>();
  const deduped = discussionOrder.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  // Round 2+: the tied candidates being voted on this round don't get a
  // turn in their own re-vote — only the rest of the village does.
  const tiedIds = ctx.state.dayVote.round >= 2 ? new Set(ctx.state.dayVote.tiedIds) : null;
  const eligible = tiedIds ? deduped.filter((id) => !tiedIds.has(id)) : deduped;
  const withoutChef = eligible.filter((id) => id !== chefId);
  return chefId && eligible.includes(chefId) ? [...withoutChef, chefId] : withoutChef;
}

export function startDayVoteQueue(ctx: EngineContext): void {
  const order = buildVoteOrder(ctx);
  ctx.state.dayVoteQueue = { order, currentSpeakerIndex: 0 };
  const firstVoterId = SpeakerQueue.currentSpeakerId(ctx.state.dayVoteQueue);
  if (firstVoterId) {
    ctx.log(`${ctx.getPlayer(firstVoterId).nickname} doit voter.`);
  }
}

export function currentVoterId(ctx: EngineContext): string | null {
  const q = ctx.state.dayVoteQueue;
  return q ? SpeakerQueue.currentSpeakerId(q) : null;
}

/** Advances to the next voter. `done: true` means the Chef's (last) turn just ended. */
export function advanceDayVoteQueue(ctx: EngineContext): { done: boolean } {
  const q = ctx.state.dayVoteQueue;
  if (!q) throw new Error("Aucun vote en cours.");
  const result = SpeakerQueue.advance(q);
  if (!result.done) {
    const nextId = SpeakerQueue.currentSpeakerId(q)!;
    ctx.log(`${ctx.getPlayer(nextId).nickname} doit voter.`);
  }
  return result;
}
