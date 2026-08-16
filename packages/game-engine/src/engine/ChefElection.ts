import type { EngineContext } from "../internalTypes";
import { shuffle } from "../util/shuffle";

export const MAX_CHEF_CANDIDATES = 3;

export function volunteerForChef(ctx: EngineContext, playerId: string): void {
  const player = ctx.getPlayer(playerId);
  if (!player.isAlive) throw new Error("Un joueur mort ne peut pas se présenter.");
  const chef = ctx.state.chef;
  if (chef.candidates.includes(playerId)) return;
  if (chef.candidates.length >= MAX_CHEF_CANDIDATES) {
    throw new Error("Le nombre maximum de candidats (3) est atteint.");
  }
  chef.candidates.push(playerId);
  ctx.log(`${player.nickname} se présente comme Chef du village.`);
}

export function startDebate(ctx: EngineContext): void {
  const chef = ctx.state.chef;
  chef.debateOrder = [...chef.candidates];
  chef.currentSpeakerIndex = 0;
}

export function advanceSpeaker(ctx: EngineContext): { done: boolean } {
  const chef = ctx.state.chef;
  chef.currentSpeakerIndex += 1;
  return { done: chef.currentSpeakerIndex >= chef.debateOrder.length };
}

export function castChefVote(ctx: EngineContext, voterId: string, candidateId: string): void {
  const chef = ctx.state.chef;
  const voter = ctx.getPlayer(voterId);
  if (!voter.isAlive) throw new Error("Un joueur mort ne peut pas voter.");
  if (chef.candidates.includes(voterId)) {
    throw new Error("Les candidats ne peuvent pas voter lors de l'élection du Chef.");
  }
  // Same one-shot, locked vote as the day vote, and for the same reason:
  // no changing your mind after the fact once it's been cast.
  if (chef.votes.has(voterId)) {
    throw new Error("Vous avez déjà voté — votre vote est verrouillé.");
  }
  if (!chef.candidates.includes(candidateId)) throw new Error("Candidat invalide.");
  chef.votes.set(voterId, candidateId);
}

/**
 * True once every eligible voter (every alive player who is NOT themselves
 * a candidate — candidates can't vote, see castChefVote) has cast a ballot.
 * Lets the server tally and reveal the Chef immediately instead of sitting
 * out the rest of CHEF_VOTE's timer once nobody's left to vote — same "no
 * fixed deadline once everyone's spoken" idea as the post-game MVP vote.
 */
export function isChefVoteComplete(ctx: EngineContext): boolean {
  const chef = ctx.state.chef;
  const eligibleVoterIds = ctx
    .getAlivePlayers()
    .map((p) => p.id)
    .filter((id) => !chef.candidates.includes(id));
  return eligibleVoterIds.length > 0 && eligibleVoterIds.every((id) => chef.votes.has(id));
}

/**
 * Live, unweighted tally of the current CHEF_VOTE (candidateId -> vote
 * count) — same idea as VoteManager.computeLiveVoteTally, but no Chef
 * double-vote bonus applies here since nobody is Chef yet at this point in
 * the game. Never touches game state, safe to call anytime.
 */
export function computeLiveChefVoteTally(ctx: EngineContext): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const candidateId of ctx.state.chef.votes.values()) {
    tally[candidateId] = (tally[candidateId] ?? 0) + 1;
  }
  return tally;
}

export function tallyChefVote(ctx: EngineContext, rng: () => number = Math.random): string {
  const chef = ctx.state.chef;
  const counts = new Map<string, number>();
  for (const candidateId of chef.candidates) counts.set(candidateId, 0);
  for (const candidateId of chef.votes.values()) {
    counts.set(candidateId, (counts.get(candidateId) ?? 0) + 1);
  }
  let best = -1;
  for (const count of counts.values()) if (count > best) best = count;
  const winners = [...counts.entries()].filter(([, count]) => count === best).map(([id]) => id);
  const electedId = winners.length === 1 ? winners[0]! : shuffle(winners, rng)[0]!;

  chef.electedId = electedId;
  const player = ctx.getPlayer(electedId);
  player.isChef = true;
  ctx.log(`${player.nickname} est élu(e) Chef du village.`);
  return electedId;
}
