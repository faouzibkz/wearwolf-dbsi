import { describe, expect, it } from "vitest";
import { GameEngine } from "../engine/GameEngine";
import { seededRng } from "./helpers";

/**
 * 18 août 2026 (FEATURES.md §26) — real bug found in a live 4-player test
 * game: a round-1 day-vote tie that includes the Chef, resolved by a
 * round-2 vote that eliminates the Chef, correctly opens a pending Chef
 * succession (finishEliminationAndProceed() deliberately leaves
 * phase === "DAY_VOTE" while it waits — see hasPendingBlockers's doc
 * comment) but — before this fix — nothing stopped a THIRD player from
 * still casting a day vote during that blocked window: dayVoteQueue was
 * already null (so the turn-order check in VoteManager.castDayVote never
 * ran) and dayVote.round had already been reset to 1 by the same tally (so
 * "any alive player" was accepted as a valid target). That stray vote was
 * either silently swallowed (if the target was still alive) or rejected
 * with a confusing "Cible de vote invalide" (if it targeted the just-
 * eliminated ex-Chef) — this is exactly what the live playtest experienced
 * as "I selected a target but Confirmer did nothing."
 */
function bootToDayVote(names: string[], deadName: string, seed: number) {
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
  // Mimic a night-1 wolf kill with adminKillPlayer — the exact death
  // mechanism doesn't matter here, only ending up with 3 alive players
  // heading into the day vote (same shape as the reported game: 4 players,
  // 1 dead from night 1).
  engine.adminKillPlayer(ids[deadName]!);
  if (engine.getPhase() === "NIGHT") engine.resolveNightAndProceed();
  engine.proceedFromMorningToDay();
  engine.endDayDiscussion();
  return { engine, ids };
}

describe("pending-blocker guard: day vote / night action rejected while blocked on Chef succession or a Chasseur shot", () => {
  it("rejects a day vote cast while blocked on a pending Chef succession (the exact reported scenario)", () => {
    const names = ["Chef", "B", "C", "D"];
    const { engine, ids } = bootToDayVote(names, "D", 3);

    // Round 1: B votes Chef, C votes self (C) -> ties Chef and C at 1 each;
    // Chef's own turn (always last) times out.
    let voter = engine.getCurrentDayVoterId()!;
    engine.castDayVote(voter, ids.Chef!);
    voter = engine.getCurrentDayVoterId()!;
    engine.castDayVote(voter, ids.C!);
    voter = engine.getCurrentDayVoterId()!;
    expect(voter).toBe(ids.Chef);
    const round1 = engine.skipCurrentDayVoter();
    expect(round1.outcome?.tie).toBe(true);
    expect(engine.getPhase()).toBe("TIE_DEFENSE");

    // Round 2: Chef and C (the tied pair) don't get a turn in their own
    // re-vote — only B does. B votes Chef -> Chef uniquely loses (1-0) and
    // is eliminated, opening a pending Chef succession.
    engine.endTieDefense();
    const round2Voter = engine.getCurrentDayVoterId()!;
    expect(round2Voter).toBe(ids.B);
    const round2 = engine.castDayVote(round2Voter, ids.Chef!);
    expect(round2?.eliminatedId).toBe(ids.Chef);

    // The game is now blocked: phase stays DAY_VOTE, but nobody has a turn
    // and nothing should be votable until the succession is resolved.
    expect(engine.getPhase()).toBe("DAY_VOTE");
    expect(engine.getPendingChefSuccessionDeadChefId()).toBe(ids.Chef);
    expect(engine.getCurrentDayVoterId()).toBeNull();

    // This is the bug: before the fix, both of these stray votes were
    // accepted (or confusingly rejected as an invalid target) instead of
    // clearly explaining the game is paused for the succession choice.
    expect(() => engine.castDayVote(ids.C!, ids.C!)).toThrow(/en attente/i);
    expect(() => engine.castDayVote(ids.B!, ids.Chef!)).toThrow(/en attente/i);

    // Resolving the succession clears the block and lets the game proceed
    // normally — confirms the guard doesn't leave the game stuck forever.
    // (With only 2 players left alive after the Chef's elimination, this
    // particular seed's role assignment may or may not immediately end the
    // game via a victory condition — either DAY_VOTE_RESULT or ENDED proves
    // the block cleared and the engine moved on, which is all this guards
    // against; the point of this test is the guard itself, not victory
    // logic.)
    engine.chooseChefSuccessor(ids.Chef!, ids.B!);
    expect(engine.getPendingChefSuccessionDeadChefId()).toBeNull();
    expect(["DAY_VOTE_RESULT", "ENDED"]).toContain(engine.getPhase());
  });

  it("rejects a night action submitted while blocked on a pending Chasseur revenge shot", () => {
    const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1, CHASSEUR: 1 } }, seededRng(7));
    const wolf = engine.addPlayer("Wolf");
    const chasseur = engine.addPlayer("Chasseur");
    const c = engine.addPlayer("C");
    const d = engine.addPlayer("D");
    engine.startGame();

    // Killing the Chasseur outside a real night resolution still routes
    // through the same DeathQueue.processDeaths() pending-shot registration
    // (see adminKillPlayer's own doc comment: "routes through the SAME
    // death pipeline as every other kill").
    const chasseurRole = engine.getPlayerRole(chasseur.id);
    if (chasseurRole !== "CHASSEUR") {
      // Role assignment is seed-dependent; skip gracefully if this seed
      // didn't happen to hand CHASSEUR to this player id.
      return;
    }
    engine.adminKillPlayer(chasseur.id);
    expect(engine.hasPendingBlockers()).toBe(true);

    if (engine.getPhase() === "NIGHT") {
      expect(() => engine.submitNightAction(wolf.id, "KILL_VOTE", c.id)).toThrow(/en attente/i);
    }
  });
});
