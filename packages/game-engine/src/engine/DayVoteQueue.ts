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
 * Important distinction from the tied-players concept: this queue is who
 * gets a TURN TO VOTE, which is every alive player, every round — it is
 * NOT the same as `dayVote.tiedIds` (who you're allowed to VOTE FOR),
 * which only narrows in round 2+. A player who isn't tied still gets a
 * turn in the re-vote; they just can't vote for someone outside the tied
 * set (that eligibility check already lives in VoteManager.castDayVote).
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
  const withoutChef = deduped.filter((id) => id !== chefId);
  return chefId && deduped.includes(chefId) ? [...withoutChef, chefId] : withoutChef;
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
