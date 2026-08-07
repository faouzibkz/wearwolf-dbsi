import type { Server } from "socket.io";
import type { Phase, TimerConfig } from "@loupgarou/shared";
import type { GameEngine } from "@loupgarou/game-engine";
import { forceNextPhase } from "./forceNextPhase.js";
import { pushAllPrompts } from "./sync.js";

const timers = new Map<string, NodeJS.Timeout>();

/**
 * Tracks, per game code, a fingerprint of "whatever this deadline is
 * currently for" (phase + whichever sub-state actually matters for
 * timing — current speaker, vote round, night/day number, or the set of
 * pending blockers). schedulePhaseTimer() runs after EVERY state mutation
 * (any chat message, vote, night action — see handlers.ts's sync()), so
 * without this, every unrelated action would blow away and recompute
 * phaseEndsAt from scratch, making the on-screen countdown visibly jump
 * back up to full duration mid-count (the exact bug reported: "30 29 28
 * 27... suddenly 40"). The fingerprint only changes when something that
 * should genuinely reset the clock happens (new phase, new speaker, new
 * vote round); any other call is a no-op for the deadline, though the
 * pending setTimeout is still recreated every time so it stays anchored to
 * the ALREADY-established deadline rather than restarting a full duration.
 */
const timerFingerprints = new Map<string, string>();

function computeTimerFingerprint(engine: GameEngine): string {
  if (engine.hasPendingBlockers()) {
    return [
      "BLOCKER",
      engine.getPendingChasseurShooterIds().slice().sort().join(","),
      engine.getPendingChefSuccessionDeadChefId() ?? "",
    ].join("|");
  }
  const s = engine.getPublicState();
  return [
    s.phase,
    s.nightNumber,
    s.dayNumber,
    s.currentSpeakerId ?? "",
    s.dayDiscussionCurrentSpeakerId ?? "",
    s.tieDefenseCurrentSpeakerId ?? "",
    engine.getDayVoteRound(),
    s.dayVoteCurrentVoterId ?? "",
    s.secondDebateChoicePending ? "CHOICE_PENDING" : "",
    s.secondDebateCurrentSpeakerId ?? "",
  ].join("|");
}

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
  // Reuses the "dayDiscussion" duration for both the Chef's choice window
  // and each bonus speaker's turn — see GameConfig.secondDebateSlots's doc
  // comment in packages/shared/src/types.ts for why there's no dedicated
  // timer field for this phase.
  CHEF_SECOND_DEBATE: "dayDiscussion",
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
  const code = engine.getCode();
  const fingerprint = computeTimerFingerprint(engine);
  const seconds = Math.max(engine.getConfig().timers.chasseurShot, engine.getConfig().timers.chefSuccession);

  if (timerFingerprints.get(code) !== fingerprint || engine.getPhaseEndsAt() === null) {
    engine.setPhaseTimer(seconds);
    timerFingerprints.set(code, fingerprint);
  }

  if (!engine.getConfig().autoProgress || engine.getPublicState().paused) return;

  const delayMs = Math.max(0, engine.getPhaseEndsAt()! - Date.now());
  const timeout = setTimeout(() => {
    try {
      engine.resolvePendingBlockersIfAny();
      pushAllPrompts(io, engine);
      schedulePhaseTimer(io, engine);
    } catch (err) {
      console.error("[timer] pending-blocker auto-resolve failed", err);
      // Do NOT let a failed auto-resolve permanently kill this game's timer
      // chain (see the matching comment in schedulePhaseTimer's own catch
      // block below for the full story) — best-effort re-arm so the next
      // tick gets a chance to recover instead of the game silently hanging
      // forever with a countdown that reaches zero and does nothing.
      try {
        pushAllPrompts(io, engine);
        schedulePhaseTimer(io, engine);
      } catch (err2) {
        console.error("[timer] pending-blocker recovery reschedule also failed", err2);
      }
    }
  }, delayMs);

  timers.set(code, timeout);
}

/**
 * Called after every state mutation. Idempotent: `phaseEndsAt` (the UI
 * countdown deadline) only actually moves when the timer fingerprint shows
 * something timing-relevant genuinely changed (new phase, new speaker, new
 * vote round) — see computeTimerFingerprint(). Only schedules an actual
 * auto-advance `setTimeout` if the admin has `autoProgress` enabled and the
 * game isn't paused. Because this function is re-invoked after every
 * mutation (including the timer's own auto-advance), phases chain
 * automatically end-to-end without any separate "scheduler loop".
 */
export function schedulePhaseTimer(io: Server, engine: GameEngine): void {
  const code = engine.getCode();
  clearPhaseTimer(code);

  if (engine.hasPendingBlockers()) {
    schedulePendingBlockerTimer(io, engine);
    return;
  }

  const phase = engine.getPhase();
  const key = PHASE_TIMER_KEY[phase];

  if (!key) {
    engine.setPhaseTimer(null);
    timerFingerprints.delete(code);
    return;
  }

  const fingerprint = computeTimerFingerprint(engine);
  if (timerFingerprints.get(code) !== fingerprint || engine.getPhaseEndsAt() === null) {
    // Genuinely new deadline: new phase, new speaker, new vote round, etc.
    const seconds = engine.getConfig().timers[key];
    engine.setPhaseTimer(seconds);
    timerFingerprints.set(code, fingerprint);
  }
  // Else: an unrelated action happened mid-phase (chat, another player's
  // vote, a night action) — leave the existing phaseEndsAt exactly where
  // it is instead of resetting the visible countdown back to full.

  if (!engine.getConfig().autoProgress || engine.getPublicState().paused) return;

  // Always re-anchor the actual setTimeout to the REMAINING time until the
  // established deadline (not a fresh full duration) — this is what keeps
  // the real auto-advance firing on schedule even though this function gets
  // called repeatedly throughout the phase.
  const delayMs = Math.max(0, engine.getPhaseEndsAt()! - Date.now());
  const timeout = setTimeout(() => {
    try {
      if (phase === "CHEF_DEBATE") {
        engine.advanceChefSpeaker();
      } else if (phase === "DAY_1_DISCUSSION" || phase === "DAY_DISCUSSION") {
        engine.advanceDaySpeaker();
      } else if (phase === "CHEF_SECOND_DEBATE") {
        // Two different deadlines share this one phase: the Chef's window
        // to CHOOSE bonus speakers (times out to "nobody chosen" — straight
        // to the vote), and — once chosen — each bonus speaker's own turn
        // (times out like any other passe-la-parole timeout).
        if (engine.isSecondDebateChoicePending()) {
          engine.endChefSecondDebate();
        } else {
          engine.advanceSecondDebateSpeaker();
        }
      } else if (phase === "TIE_DEFENSE") {
        engine.advanceTieDefenseSpeaker();
      } else if (phase === "DAY_VOTE") {
        // Per-voter turn timeout: skip whoever's turn it currently is (no
        // vote recorded) and advance the queue. If that was the last voter,
        // skipCurrentDayVoter() itself triggers the tally/phase transition.
        engine.skipCurrentDayVoter();
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
      // CRITICAL: this catch existed before but only ever logged and gave
      // up — it did NOT reschedule anything. Every auto-advance (including
      // the CHEF_SECOND_DEBATE -> DAY_VOTE and DAY_VOTE per-voter-skip
      // transitions) runs through this exact callback, so ANY exception
      // here — even a transient/unexpected one — used to permanently kill
      // this game's entire auto-progress chain: no further timer would
      // EVER fire again for this game, no matter how long anyone waited,
      // with no error shown to any client. That's a real, serious failure
      // mode (a countdown that reaches zero and does nothing, forever) —
      // this is very likely what caused a real stuck-vote report. Recover
      // by re-broadcasting state and re-arming the timer chain from
      // whatever the CURRENT engine state actually is, so a transient
      // failure can self-heal on the next tick instead of hanging the game
      // forever.
      console.error("[timer] auto-advance failed", err);
      try {
        pushAllPrompts(io, engine);
        schedulePhaseTimer(io, engine);
      } catch (err2) {
        console.error("[timer] auto-advance recovery reschedule also failed", err2);
      }
    }
  }, delayMs);

  timers.set(code, timeout);
}
