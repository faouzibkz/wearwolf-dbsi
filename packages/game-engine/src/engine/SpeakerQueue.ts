/**
 * Tiny shared shape for "an ordered list of speakers, one active at a
 * time." Both the Chef election debate (`ChefElection.debateOrder` /
 * `currentSpeakerIndex`) and the day discussion (`DayDiscussion.ts`, new)
 * are this same shape — this file exists so the "advance to the next
 * speaker" logic isn't duplicated between them.
 *
 * ChefElection's own fields aren't rewritten to use this directly (not
 * worth the regression risk to already-solid, tested code for a pure
 * rename), but DayDiscussion is built on it from the start, and
 * ChefElection could adopt it later with no behavior change.
 */
export interface SpeakerQueueState {
  order: string[]; // player ids, in speaking order
  currentSpeakerIndex: number;
}

export function currentSpeakerId(q: SpeakerQueueState): string | null {
  return q.order[q.currentSpeakerIndex] ?? null;
}

export function advance(q: SpeakerQueueState): { done: boolean } {
  q.currentSpeakerIndex += 1;
  return { done: q.currentSpeakerIndex >= q.order.length };
}
