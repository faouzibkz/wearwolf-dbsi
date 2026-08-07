import { describe, expect, it } from "vitest";
import { GameEngine } from "../engine/GameEngine";
import { castDayVotesInOrder, seededRng } from "./helpers";

/**
 * TIE_DEFENSE: the tied players (2 or 3) each get one randomly-ordered
 * defense turn (same per-speaker queue mechanic as the Chef debate and day
 * discussion — see engine/TieDefense.ts), and round 2 of the vote must
 * start with a clean ballot instead of silently carrying over round 1's
 * votes for anyone who doesn't recast.
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
  engine.resolveNightAndProceed();
  engine.proceedFromMorningToDay();
  engine.endDayDiscussion();
  return { engine, ids };
}

describe("TIE_DEFENSE speaking order", () => {
  it("builds a randomly-ordered queue of exactly the tied players, one turn each", () => {
    const names = ["A", "B", "C", "D"];
    const { engine, ids } = bootToDayVote(names, 9);

    const outcome = castDayVotesInOrder(engine, {
      [ids.A!]: ids.C!,
      [ids.B!]: ids.D!,
      [ids.C!]: ids.C!,
      [ids.D!]: ids.D!,
    });

    expect(outcome?.tie).toBe(true);
    expect(engine.getPhase()).toBe("TIE_DEFENSE");
    const order = engine.getPublicState().tieDefenseOrder!;
    expect(order.slice().sort()).toEqual([ids.C, ids.D].sort());
    expect(order).toHaveLength(2); // each once, no repeats (unlike the Chef's two turns)
    expect(engine.getPublicState().tieDefenseCurrentSpeakerId).toBe(order[0]);
  });

  it("is null outside TIE_DEFENSE", () => {
    const names = ["A", "B", "C", "D"];
    const { engine } = bootToDayVote(names, 9);
    expect(engine.getPhase()).toBe("DAY_VOTE");
    expect(engine.getPublicState().tieDefenseOrder).toBeNull();
    expect(engine.getPublicState().tieDefenseCurrentSpeakerId).toBeNull();
  });

  it("advances speaker by speaker and auto-transitions to DAY_VOTE once the last tied player finishes", () => {
    const names = ["A", "B", "C", "D"];
    const { engine, ids } = bootToDayVote(names, 9);
    castDayVotesInOrder(engine, {
      [ids.A!]: ids.C!,
      [ids.B!]: ids.D!,
      [ids.C!]: ids.C!,
      [ids.D!]: ids.D!,
    });

    const order = engine.getPublicState().tieDefenseOrder!;
    expect(order).toHaveLength(2);

    const first = engine.advanceTieDefenseSpeaker();
    expect(first.done).toBe(false);
    expect(engine.getPhase()).toBe("TIE_DEFENSE");
    expect(engine.getCurrentTieDefenseSpeakerId()).toBe(order[1]);

    const second = engine.advanceTieDefenseSpeaker();
    expect(second.done).toBe(true);
    expect(engine.getPhase()).toBe("DAY_VOTE"); // auto-advanced, no manual endTieDefense() needed

    // Regression test for a real bug: this natural (non-manual) transition
    // used to set the phase to DAY_VOTE WITHOUT building the per-voter
    // queue, which permanently stranded the game — nobody's turn ever came
    // up, so nobody could vote, the per-voter timer's auto-skip was a
    // silent no-op forever, and even "force next phase" did nothing.
    expect(engine.getPublicState().dayVoteOrder).not.toBeNull();
    expect(engine.getPublicState().dayVoteOrder!.length).toBeGreaterThan(0);
    expect(engine.getCurrentDayVoterId()).not.toBeNull();

    // And voting must actually work: walk the whole round to completion.
    const alive = engine.getPublicState().players.filter((p) => p.isAlive).map((p) => p.id);
    const votes: Record<string, string> = {};
    for (const id of alive) votes[id] = ids.C!;
    const outcome = castDayVotesInOrder(engine, votes);
    expect(outcome?.eliminatedId).toBe(ids.C);
  });

  it("manual endTieDefense() still works as a skip-ahead regardless of queue position", () => {
    const names = ["A", "B", "C", "D"];
    const { engine, ids } = bootToDayVote(names, 9);
    castDayVotesInOrder(engine, {
      [ids.A!]: ids.C!,
      [ids.B!]: ids.D!,
      [ids.C!]: ids.C!,
      [ids.D!]: ids.D!,
    });

    engine.endTieDefense();
    expect(engine.getPhase()).toBe("DAY_VOTE");
  });

  it("rejects advanceTieDefenseSpeaker() outside TIE_DEFENSE", () => {
    const names = ["A", "B", "C", "D"];
    const { engine } = bootToDayVote(names, 9);
    expect(() => engine.advanceTieDefenseSpeaker()).toThrow();
  });
});

describe("round 2 starts with a clean ballot (no stale round-1 votes carried over)", () => {
  it("does not count a tied player's round-1 vote if they abstain in round 2", () => {
    const names = ["A", "B", "C", "D"];
    const { engine, ids } = bootToDayVote(names, 9);

    // Round 1: only A and B vote (C and D, the eventual tied pair,
    // abstain), tying C vs D.
    const round1 = castDayVotesInOrder(engine, { [ids.A!]: ids.C!, [ids.B!]: ids.D! });
    expect(round1?.tie).toBe(true);
    engine.endTieDefense(); // -> DAY_VOTE round 2

    // The live tally must be empty right away — no leftover round-1 votes.
    expect(engine.getPublicState().dayVotes).toEqual({});
    expect(engine.getPublicState().dayVoteTally).toEqual({});

    // Round 2: ONLY A votes (for C this time); B abstains entirely.
    const round2 = castDayVotesInOrder(engine, { [ids.A!]: ids.C! });

    // If B's stale round-1 vote for D had leaked through, this would be a
    // 1-1 tie again instead of a clean win for C.
    expect(round2?.tie).toBe(false);
    expect(round2?.eliminatedId).toBe(ids.C);
  });

  it("lets a tied player change their vote in round 2 without their round-1 choice lingering", () => {
    const names = ["A", "B", "C", "D"];
    const { engine, ids } = bootToDayVote(names, 9);

    castDayVotesInOrder(engine, { [ids.A!]: ids.C!, [ids.B!]: ids.D! });
    engine.endTieDefense();

    // Both flip their vote in round 2.
    const round2 = castDayVotesInOrder(engine, { [ids.A!]: ids.D!, [ids.B!]: ids.D! });

    expect(round2?.eliminatedId).toBe(ids.D);
  });
});
