import type { EngineContext } from "../internalTypes";
import { shuffle } from "../util/shuffle";
import * as SpeakerQueue from "./SpeakerQueue";

/**
 * Builds today's speaking order: the Chef speaks first AND last (two
 * turns), every other alive player speaks once in between, in a fresh
 * shuffled order. Used identically for DAY_1_DISCUSSION and
 * DAY_DISCUSSION — same mechanic both times, just triggered from two
 * different points in the phase cycle (see GameEngine.tallyChefVoteAndProceed
 * and GameEngine.proceedFromMorningToDay).
 *
 * A fresh independent shuffle every day (rather than some persistent
 * fairness-tracking queue) is deliberate: with everyone speaking every
 * single day, there's no "who gets picked" question to be fair about,
 * only ordering — and a plain shuffle is already unbiased over the
 * course of a game. No extra bookkeeping needed to get that right.
 */
export function startDayDiscussion(ctx: EngineContext, rng: () => number = Math.random): void {
  const alive = ctx.getAlivePlayers();
  const chef = alive.find((p) => p.isChef) ?? null;
  const others = alive.filter((p) => p.id !== chef?.id).map((p) => p.id);
  const shuffledOthers = shuffle(others, rng);
  const order = chef ? [chef.id, ...shuffledOthers, chef.id] : shuffledOthers;

  ctx.state.dayDiscussion = { order, currentSpeakerIndex: 0 };

  const firstSpeakerId = SpeakerQueue.currentSpeakerId(ctx.state.dayDiscussion);
  if (firstSpeakerId) {
    ctx.log(`${ctx.getPlayer(firstSpeakerId).nickname} commence la discussion.`);
  }
}

export function currentDaySpeakerId(ctx: EngineContext): string | null {
  const dd = ctx.state.dayDiscussion;
  return dd ? SpeakerQueue.currentSpeakerId(dd) : null;
}

/** Advances to the next speaker. `done: true` means the Chef's closing turn just ended. */
export function advanceDaySpeaker(ctx: EngineContext): { done: boolean } {
  const dd = ctx.state.dayDiscussion;
  if (!dd) throw new Error("Aucune discussion en cours.");
  const result = SpeakerQueue.advance(dd);
  if (!result.done) {
    const nextId = SpeakerQueue.currentSpeakerId(dd)!;
    ctx.log(`${ctx.getPlayer(nextId).nickname} prend la parole.`);
  }
  return result;
}
