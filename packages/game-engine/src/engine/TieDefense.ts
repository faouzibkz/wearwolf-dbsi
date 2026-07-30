import type { EngineContext } from "../internalTypes";
import { shuffle } from "../util/shuffle";
import * as SpeakerQueue from "./SpeakerQueue";

/**
 * TIE_DEFENSE: the players tied in the day vote each get one turn to
 * defend themselves before the village re-votes. Same per-speaker queue
 * mechanic as DayDiscussion/ChefElection (see SpeakerQueue.ts), just with
 * a random order over the (2 or 3) tied players and no second turn for
 * anyone — unlike the Chef, nobody here speaks twice.
 */
export function startTieDefense(ctx: EngineContext, rng: () => number = Math.random): void {
  const order = shuffle([...ctx.state.dayVote.tiedIds], rng);
  ctx.state.tieDefense = { order, currentSpeakerIndex: 0 };

  const firstSpeakerId = SpeakerQueue.currentSpeakerId(ctx.state.tieDefense);
  if (firstSpeakerId) {
    ctx.log(`${ctx.getPlayer(firstSpeakerId).nickname} commence sa défense.`);
  }
}

export function currentTieDefenseSpeakerId(ctx: EngineContext): string | null {
  const td = ctx.state.tieDefense;
  return td ? SpeakerQueue.currentSpeakerId(td) : null;
}

/** Advances to the next defending player. `done: true` once the last tied player's turn ends. */
export function advanceTieDefenseSpeaker(ctx: EngineContext): { done: boolean } {
  const td = ctx.state.tieDefense;
  if (!td) throw new Error("Aucune défense en cours.");
  const result = SpeakerQueue.advance(td);
  if (!result.done) {
    const nextId = SpeakerQueue.currentSpeakerId(td)!;
    ctx.log(`${ctx.getPlayer(nextId).nickname} prend la parole pour sa défense.`);
  }
  return result;
}
