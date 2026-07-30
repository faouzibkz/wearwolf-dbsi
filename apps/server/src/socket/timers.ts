import type { Server } from "socket.io";
import type { Phase, TimerConfig } from "@loupgarou/shared";
import type { GameEngine } from "@loupgarou/game-engine";
import { forceNextPhase } from "./forceNextPhase.js";
import { pushAllPrompts } from "./sync.js";

const timers = new Map<string, NodeJS.Timeout>();

const PHASE_TIMER_KEY: Partial<Record<Phase, keyof TimerConfig>> = {
  CHEF_CANDIDACY: "chefCandidacy",
  CHEF_DEBATE: "chefDebate",
  CHEF_VOTE: "chefVote",
  CHEF_REVEAL: "chefReveal",
  // DAY_1_DISCUSSION deliberately reuses the "dayDiscussion" timer value
  // (not its own "day1Discussion" config field, which still exists in
  // TimerConfig but is no longer admin-configurable) — day 1's discussion
  // and every later day's discussion are now the same per-speaker
  // mechanic, so they share one duration.
  DAY_1_DISCUSSION: "dayDiscussion",
  NIGHT: "night",
  MORNING: "morningReveal",
  DAY_DISCUSSION: "dayDiscussion",
  DAY_VOTE: "dayVote",
  DAY_VOTE_RESULT: "dayVoteResult",
  TIE_DEFENSE: "tieDefense",
  TIE_REVOTE: "tieRevote",
};

export function clearPhaseTimer(code: string): void {
  const t = timers.get(code);
  if (t) {
    clearTimeout(t);
    timers.delete(code);
  }
}

/**
 * A pending Chasseur shot and/or Chef succession can interrupt NIGHT
 * resolution or a DAY_VOTE elimination at any moment. When that happens the
 * surrounding phase does NOT change — `engine.getPhase()` still reports
 * "NIGHT" or "DAY_VOTE" while the game is really just parked, waiting on
 * one specific player's decision (see GameEngine.hasPendingBlockers()).
 *
 * This matters for scheduling: if we naively rescheduled that surrounding
 * phase's own (much longer) timer while blocked, it would eventually fire
 * and call resolveNightAndProceed() / tallyDayVoteAndProceed() a SECOND
 * time on top of an already-resolved night/vote — re-running resolution,
 * re-applying wolf/vote effects, and in the DAY_VOTE case landing on a
 * vote tally over an already-cleared ballot (which corrupts into a bogus
 * "everyone's tied" state). So: whenever a blocker is pending, we schedule
 * a dedicated, much shorter deadline for THAT decision instead, and let
 * GameEngine.resolvePendingBlockersIfAny() auto-pick a random target once
 * it expires. Only once every blocker clears does the surrounding phase's
 * normal timer resume.
 */
function schedulePendingBlockerTimer(io: Server, engine: GameEngine): void {
  const seconds = Math.max(engine.getConfig().timers.chasseurShot, engine.getConfig().timers.chefSuccession);
  engine.setPhaseTimer(seconds);

  if (!engine.getConfig().autoProgress || engine.getPublicState().paused) return;

  const timeout = setTimeout(() => {
    try {
      engine.resolvePendingBlockersIfAny();
      pushAllPrompts(io, engine);
      schedulePhaseTimer(io, engine);
    } catch (err) {
      console.error("[timer] pending-blocker auto-resolve failed", err);
    }
  }, seconds * 1000);

  timers.set(engine.getCode(), timeout);
}

/**
 * Called after every state mutation. Always refreshes `phaseEndsAt` for the
 * UI countdown; only actually schedules an auto-advance if the admin has
 * `autoProgress` enabled and the game isn't paused. Because this function
 * is re-invoked after every mutation (including the timer's own
 * auto-advance), phases chain automatically end-to-end without any
 * separate "scheduler loop".
 */
export function schedulePhaseTimer(io: Server, engine: GameEngine): void {
  clearPhaseTimer(engine.getCode());

  if (engine.hasPendingBlockers()) {
    schedulePendingBlockerTimer(io, engine);
    return;
  }

  const phase = engine.getPhase();
  const key = PHASE_TIMER_KEY[phase];

  if (!key) {
    engine.setPhaseTimer(null);
    return;
  }

  const seconds = engine.getConfig().timers[key];
  engine.setPhaseTimer(seconds);

  if (!engine.getConfig().autoProgress || engine.getPublicState().paused) return;

  const timeout = setTimeout(() => {
    try {
      if (phase === "CHEF_DEBATE") {
        engine.advanceChefSpeaker();
      } else if (phase === "DAY_1_DISCUSSION" || phase === "DAY_DISCUSSION") {
        engine.advanceDaySpeaker();
      } else if (phase === "TIE_DEFENSE") {
        engine.advanceTieDefenseSpeaker();
      } else if (phase === "TIE_REVOTE") {
        // The one deliberately-manual checkpoint still gets a safety net:
        // if nobody (Chef/Admin) resolves it in time, break the tie at
        // random rather than freeze a fully-automatic game forever.
        engine.autoResolveTieRevoteIfPending();
      } else {
        forceNextPhase(engine);
      }
      pushAllPrompts(io, engine);
      schedulePhaseTimer(io, engine);
    } catch (err) {
      console.error("[timer] auto-advance failed", err);
    }
  }, seconds * 1000);

  timers.set(engine.getCode(), timeout);
}
