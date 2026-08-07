import { describe, expect, it } from "vitest";
import { GameEngine } from "../engine/GameEngine";
import { castDayVotesInOrder, seededRng } from "./helpers";

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

describe("DAY_VOTE turn queue (feature 3: sequential per-player vote)", () => {
  it("includes every alive player exactly once, with the Chef always last", () => {
    const names = ["Chef", "B", "C", "D", "E"];
    const { engine, ids } = bootToDayVote(names, 3);

    const order = engine.getPublicState().dayVoteOrder!;
    expect(order).toHaveLength(5);
    expect(new Set(order)).toEqual(new Set(names.map((n) => ids[n]!)));
    expect(order[order.length - 1]).toBe(ids.Chef);
  });

  it("is null outside DAY_VOTE", () => {
    const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1 } }, seededRng(2));
    expect(engine.getPublicState().dayVoteOrder).toBeNull();
    expect(engine.getPublicState().dayVoteCurrentVoterId).toBeNull();
    expect(engine.getCurrentDayVoterId()).toBeNull();
  });

  it("getCurrentDayVoterId()/dayVoteCurrentVoterId agree and point at the first voter", () => {
    const names = ["Chef", "B", "C", "D", "E"];
    const { engine } = bootToDayVote(names, 3);

    const order = engine.getPublicState().dayVoteOrder!;
    expect(engine.getCurrentDayVoterId()).toBe(order[0]);
    expect(engine.getPublicState().dayVoteCurrentVoterId).toBe(order[0]);
  });

  it("rejects a vote from anyone other than the current voter", () => {
    const names = ["Chef", "B", "C", "D", "E"];
    const { engine, ids } = bootToDayVote(names, 3);
    const current = engine.getCurrentDayVoterId()!;
    const someoneElse = names.map((n) => ids[n]!).find((id) => id !== current)!;
    expect(() => engine.castDayVote(someoneElse, ids.Chef!)).toThrow(/tour/);
  });

  it("casting a vote immediately advances the queue to the next voter", () => {
    const names = ["Chef", "B", "C", "D", "E"];
    const { engine, ids } = bootToDayVote(names, 3);
    const order = engine.getPublicState().dayVoteOrder!;
    const first = order[0]!;
    engine.castDayVote(first, ids.Chef!);
    expect(engine.getCurrentDayVoterId()).toBe(order[1]);
  });

  it("skipping (timeout) a turn advances the queue WITHOUT recording a vote", () => {
    const names = ["Chef", "B", "C", "D", "E"];
    const { engine } = bootToDayVote(names, 3);
    const order = engine.getPublicState().dayVoteOrder!;
    const first = order[0]!;
    const { done } = engine.skipCurrentDayVoter();
    expect(done).toBe(false);
    expect(engine.getCurrentDayVoterId()).toBe(order[1]);
    expect(engine.getPublicState().dayVotes[first]).toBeUndefined();
  });

  it("skipping every single turn (nobody votes) still auto-tallies once the Chef's turn ends", () => {
    const names = ["Chef", "B", "C", "D", "E"];
    const { engine } = bootToDayVote(names, 3);

    let done = false;
    let outcome = null;
    while (!done) {
      const r = engine.skipCurrentDayVoter();
      done = r.done;
      outcome = r.outcome;
    }
    // Nobody voted -> every alive candidate is tied at 0 -> tie handling kicks in.
    expect(outcome).not.toBeNull();
    expect(outcome!.tie).toBe(true);
  });

  it("casting the Chef's own (last) vote auto-tallies and returns the outcome", () => {
    const names = ["Chef", "B", "C", "D", "E"];
    const { engine, ids } = bootToDayVote(names, 3);

    let voterId: string | null;
    let lastOutcome = null;
    while ((voterId = engine.getCurrentDayVoterId()) !== null) {
      lastOutcome = engine.castDayVote(voterId, ids.C!);
    }
    expect(lastOutcome).not.toBeNull();
    expect(lastOutcome!.eliminatedId).toBe(ids.C);
    // The round's queue is cleared once it's been tallied.
    expect(engine.getPublicState().dayVoteOrder).toBeNull();
    expect(engine.getCurrentDayVoterId()).toBeNull();
  });

  it("rebuilds a fresh queue (all alive players, Chef last again) for round 2 after a tie", () => {
    const names = ["Chef", "B", "C", "D"];
    const { engine, ids } = bootToDayVote(names, 9);

    // B votes C, C votes D (a clean 1-1 tie); D and the Chef abstain.
    const outcome = castDayVotesInOrder(engine, { [ids.B!]: ids.C!, [ids.C!]: ids.D! });
    expect(outcome?.tie).toBe(true);
    expect(engine.getPhase()).toBe("TIE_DEFENSE");

    engine.endTieDefense();
    expect(engine.getPhase()).toBe("DAY_VOTE");

    const round2Order = engine.getPublicState().dayVoteOrder!;
    expect(new Set(round2Order)).toEqual(new Set(names.map((n) => ids[n]!)));
    expect(round2Order[round2Order.length - 1]).toBe(ids.Chef);
  });
});
