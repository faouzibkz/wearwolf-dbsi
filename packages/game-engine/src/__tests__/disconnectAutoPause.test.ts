import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { GameEngine } from "../engine/GameEngine";
import { seededRng } from "./helpers";

/**
 * 18 août 2026 (FEATURES.md §27) — real live-game incident: a Salvateur's
 * connection blipped during their own 30s sequential-night step and their
 * protection was silently skipped (no PROTECT action ever reached the
 * server — the action log for that night shows nothing), and separately a
 * day-voter caught by a mass network drop got skipped mid-turn the same way
 * — forcing the group to stop the game. Neither was a rejected action; the
 * hard per-turn timeout doesn't distinguish "thinking" from "disconnected".
 *
 * The fix: GameEngine.pauseForDisconnect()/resumeFromDisconnect() freeze the
 * phase clock (reusing the exact pause()/resume()/pausedRemainingMs
 * machinery the admin's manual pause button already relies on) the instant
 * the player the game is CURRENTLY waiting on drops, and resume it with the
 * same remaining time the moment they're back — scoped so an unrelated
 * player's disconnect never freezes the whole table, and so a player who is
 * connected but simply slow/AFK still eventually gets skipped by the normal
 * timeout (apps/server/src/socket/timers.ts never arms its setTimeout while
 * engine.getPublicState().paused is true — see schedulePhaseTimer).
 */

function bootToDayVote(names: string[], seed: number) {
  const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1 } }, seededRng(seed));
  const ids: Record<string, string> = {};
  for (const n of names) ids[n] = engine.addPlayer(n).id;
  engine.startGame();
  engine.volunteerForChef(ids[names[0]!]!);
  engine.forceStartChefDebate();
  engine.advanceChefSpeaker();
  for (const n of names.slice(1)) engine.castChefVote(ids[n]!, ids[names[0]!]!);
  engine.tallyChefVoteAndProceed();
  engine.proceedFromChefRevealToDiscussion();
  engine.endDay1Discussion();
  if (engine.getPhase() === "NIGHT") engine.resolveNightAndProceed();
  engine.proceedFromMorningToDay();
  engine.endDayDiscussion();
  return { engine, ids };
}

describe("disconnect-aware auto-pause (getCurrentActionRequiredPlayerIds / pauseForDisconnect / resumeFromDisconnect)", () => {
  describe("DAY_VOTE", () => {
    it("pauses when the current voter disconnects, and is a no-op for anyone else", () => {
      const { engine, ids } = bootToDayVote(["Chef", "B", "C", "D"], 3);
      const currentVoter = engine.getCurrentDayVoterId()!;
      expect(engine.getCurrentActionRequiredPlayerIds()).toEqual([currentVoter]);

      const bystander = Object.values(ids).find((id) => id !== currentVoter)!;
      engine.pauseForDisconnect(bystander);
      expect(engine.getPublicState().paused).toBe(false);
      expect(engine.getDisconnectPausedPlayerId()).toBeNull();

      engine.pauseForDisconnect(currentVoter);
      expect(engine.getPublicState().paused).toBe(true);
      expect(engine.getDisconnectPausedPlayerId()).toBe(currentVoter);
      expect(engine.isPausedForDisconnect()).toBe(true);
    });

    it("resumes on reconnect and the voter can still cast their vote normally", () => {
      const { engine, ids } = bootToDayVote(["Chef", "B", "C", "D"], 3);
      const currentVoter = engine.getCurrentDayVoterId()!;
      engine.pauseForDisconnect(currentVoter);
      expect(engine.getPublicState().paused).toBe(true);

      engine.resumeFromDisconnect(currentVoter);
      expect(engine.getPublicState().paused).toBe(false);
      expect(engine.getDisconnectPausedPlayerId()).toBeNull();

      const target = Object.values(ids).find((id) => id !== currentVoter)!;
      expect(() => engine.castDayVote(currentVoter, target)).not.toThrow();
    });

    it("resumeFromDisconnect is a no-op for the wrong player id", () => {
      const { engine } = bootToDayVote(["Chef", "B", "C", "D"], 3);
      const currentVoter = engine.getCurrentDayVoterId()!;
      engine.pauseForDisconnect(currentVoter);
      expect(engine.getPublicState().paused).toBe(true);

      engine.resumeFromDisconnect("someone-else");
      expect(engine.getPublicState().paused).toBe(true);
      expect(engine.getDisconnectPausedPlayerId()).toBe(currentVoter);
    });
  });

  describe("pending blockers (Chef succession / Chasseur shot) take priority", () => {
    it("pauses when the dead Chef (pending successor) disconnects, even mid-DAY_VOTE", () => {
      const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1 } }, seededRng(3));
      const ids: Record<string, string> = {};
      for (const n of ["Chef", "B", "C", "D"]) ids[n] = engine.addPlayer(n).id;
      engine.startGame();
      engine.volunteerForChef(ids.Chef!);
      engine.forceStartChefDebate();
      engine.advanceChefSpeaker();
      for (const n of ["B", "C", "D"]) engine.castChefVote(ids[n]!, ids.Chef!);
      engine.tallyChefVoteAndProceed();
      engine.proceedFromChefRevealToDiscussion();
      engine.endDay1Discussion();
      engine.adminKillPlayer(ids.D!);
      if (engine.getPhase() === "NIGHT") engine.resolveNightAndProceed();
      engine.proceedFromMorningToDay();
      engine.endDayDiscussion();

      // Round 1: B -> Chef, C -> C (self) => Chef & C tied, Chef's own turn
      // (always last) times out.
      engine.castDayVote(engine.getCurrentDayVoterId()!, ids.Chef!);
      engine.castDayVote(engine.getCurrentDayVoterId()!, ids.C!);
      expect(engine.getCurrentDayVoterId()).toBe(ids.Chef);
      engine.skipCurrentDayVoter();
      expect(engine.getPhase()).toBe("TIE_DEFENSE");
      engine.endTieDefense();
      // Round 2: only B has a turn (Chef & C are the tied pair) -> Chef loses.
      const outcome = engine.castDayVote(engine.getCurrentDayVoterId()!, ids.Chef!);
      expect(outcome?.eliminatedId).toBe(ids.Chef);
      expect(engine.getPendingChefSuccessionDeadChefId()).toBe(ids.Chef);

      expect(engine.getCurrentActionRequiredPlayerIds()).toEqual([ids.Chef]);

      // An unrelated alive player disconnecting must not freeze the table.
      engine.pauseForDisconnect(ids.B!);
      expect(engine.getPublicState().paused).toBe(false);

      // The dead Chef (who still owes a successor choice) disconnecting must.
      engine.pauseForDisconnect(ids.Chef!);
      expect(engine.getPublicState().paused).toBe(true);
      expect(engine.getDisconnectPausedPlayerId()).toBe(ids.Chef);

      engine.resumeFromDisconnect(ids.Chef!);
      expect(engine.getPublicState().paused).toBe(false);
      expect(() => engine.chooseChefSuccessor(ids.Chef!, ids.B!)).not.toThrow();
    });
  });

  describe("SEQUENTIAL night", () => {
    it("pauses when the current step's actor disconnects, not for a role not yet up", () => {
      const engine = GameEngine.createGame(
        { roleCounts: { LOUP_GAROU: 1, SALVATEUR: 1 }, nightMode: "SEQUENTIAL" },
        seededRng(11),
      );
      const ids: Record<string, string> = {};
      for (const n of ["A", "B", "C", "D"]) ids[n] = engine.addPlayer(n).id;
      engine.startGame();
      engine.volunteerForChef(ids.A!);
      engine.forceStartChefDebate();
      engine.advanceChefSpeaker();
      for (const n of ["B", "C", "D"]) engine.castChefVote(ids[n]!, ids.A!);
      engine.tallyChefVoteAndProceed();
      engine.proceedFromChefRevealToDiscussion();
      engine.endDay1Discussion();
      expect(engine.getPhase()).toBe("NIGHT");

      const currentActors = engine.getCurrentActionRequiredPlayerIds();
      expect(currentActors.length).toBeGreaterThan(0);
      const currentActorId = currentActors[0]!;
      const notCurrentlyActing = Object.values(ids).find((id) => !currentActors.includes(id));

      if (notCurrentlyActing) {
        engine.pauseForDisconnect(notCurrentlyActing);
        expect(engine.getPublicState().paused).toBe(false);
      }

      engine.pauseForDisconnect(currentActorId);
      expect(engine.getPublicState().paused).toBe(true);
      expect(engine.getDisconnectPausedPlayerId()).toBe(currentActorId);

      // Reconnecting lets them still submit their action normally.
      engine.resumeFromDisconnect(currentActorId);
      expect(engine.getPublicState().paused).toBe(false);
      const role = engine.getPlayerRole(currentActorId);
      const alive = Object.values(ids).filter((id) => id !== currentActorId);
      if (role === "SALVATEUR") {
        expect(() => engine.submitNightAction(currentActorId, "PROTECT", alive[0]!)).not.toThrow();
      } else if (role === "LOUP_GAROU") {
        expect(() => engine.submitNightAction(currentActorId, "KILL_VOTE", alive[0]!)).not.toThrow();
      }
    });
  });

  describe("admin manual pause interplay", () => {
    it("does not take ownership if the game is already paused (admin pause), and won't later auto-resume it", () => {
      const { engine } = bootToDayVote(["Chef", "B", "C", "D"], 3);
      const currentVoter = engine.getCurrentDayVoterId()!;

      engine.pause(); // admin manual pause
      expect(engine.getPublicState().paused).toBe(true);
      expect(engine.getDisconnectPausedPlayerId()).toBeNull();

      engine.pauseForDisconnect(currentVoter);
      // Still paused, but we deliberately didn't claim it.
      expect(engine.getPublicState().paused).toBe(true);
      expect(engine.getDisconnectPausedPlayerId()).toBeNull();

      // A reconnect for that same player must NOT auto-resume an admin pause
      // we never claimed ownership of.
      engine.resumeFromDisconnect(currentVoter);
      expect(engine.getPublicState().paused).toBe(true);
    });

    it("engine.resume() (ADMIN_RESUME) always clears disconnectPausedPlayerId", () => {
      const { engine } = bootToDayVote(["Chef", "B", "C", "D"], 3);
      const currentVoter = engine.getCurrentDayVoterId()!;
      engine.pauseForDisconnect(currentVoter);
      expect(engine.getDisconnectPausedPlayerId()).toBe(currentVoter);

      engine.resume();
      expect(engine.getPublicState().paused).toBe(false);
      expect(engine.getDisconnectPausedPlayerId()).toBeNull();
    });
  });

  describe("timing: remaining time is preserved across a pause of any length", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-18T20:00:00.000Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("hands back exactly the remaining time on resume, no matter how long the disconnect lasted", () => {
      const { engine } = bootToDayVote(["Chef", "B", "C", "D"], 3);
      const currentVoter = engine.getCurrentDayVoterId()!;
      engine.setPhaseTimer(25); // e.g. timers.dayVote
      const deadlineBefore = engine.getPhaseEndsAt()!;

      vi.advanceTimersByTime(10_000); // 10s pass, 15s should remain
      engine.pauseForDisconnect(currentVoter);

      // Whether the outage lasts 1 second or 10 minutes, the remaining
      // budget must not silently drain while paused.
      vi.advanceTimersByTime(10 * 60 * 1000);
      engine.resumeFromDisconnect(currentVoter);

      const deadlineAfter = engine.getPhaseEndsAt()!;
      const remainingBefore = deadlineBefore - 10_000 - new Date("2026-08-18T20:00:00.000Z").getTime();
      const remainingAfter = deadlineAfter - Date.now();
      expect(remainingAfter).toBeCloseTo(remainingBefore, -2);
    });
  });
});
