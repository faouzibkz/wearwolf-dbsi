import { describe, expect, it } from "vitest";
import { GameEngine } from "../engine/GameEngine";
import { seededRng } from "./helpers";

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
  engine.endDay1Discussion();
  engine.resolveNightAndProceed(); // nobody targeted, nobody dies
  engine.proceedFromMorningToDay();
  engine.endDayDiscussion();
  return { engine, ids };
}

describe("day vote is a live, open ballot", () => {
  it("exposes every cast vote (voterId -> targetId) during DAY_VOTE, live as votes come in", () => {
    const names = ["A", "B", "C", "D", "E"];
    const { engine, ids } = bootToDayVote(names, 5);

    expect(engine.getPublicState().dayVotes).toEqual({});

    engine.castDayVote(ids.A!, ids.C!);
    expect(engine.getPublicState().dayVotes).toEqual({ [ids.A!]: ids.C! });

    engine.castDayVote(ids.B!, ids.C!);
    expect(engine.getPublicState().dayVotes).toEqual({ [ids.A!]: ids.C!, [ids.B!]: ids.C! });

    // Changing your mind updates your entry live, not adds a second one.
    engine.castDayVote(ids.A!, ids.D!);
    expect(engine.getPublicState().dayVotes).toEqual({ [ids.A!]: ids.D!, [ids.B!]: ids.C! });
  });

  it("never leaks votes outside the DAY_VOTE phase (not during TIE_DEFENSE, not after resolution)", () => {
    const names = ["A", "B", "C", "D", "E"];
    const { engine, ids } = bootToDayVote(names, 5);

    engine.castDayVote(ids.A!, ids.C!);
    engine.castDayVote(ids.B!, ids.D!);
    engine.castDayVote(ids.C!, ids.C!);
    engine.castDayVote(ids.D!, ids.D!);
    engine.castDayVote(ids.E!, ids.C!);
    // C: A,C,E = 3 votes; D: B,D = 2 votes -> no tie, C is eliminated.
    const outcome = engine.tallyDayVoteAndProceed();

    expect(outcome.eliminatedId).toBe(ids.C);
    // We're in NIGHT now (or wherever finishEliminationAndProceed lands) —
    // either way, no stale votes should still be exposed.
    expect(engine.getPublicState().dayVotes).toEqual({});
  });

  it("is hidden during TIE_DEFENSE (players are defending, not voting) and reappears once round 2 opens", () => {
    const names = ["A", "B", "C", "D"];
    const { engine, ids } = bootToDayVote(names, 9);

    engine.castDayVote(ids.A!, ids.C!);
    engine.castDayVote(ids.B!, ids.D!);
    engine.castDayVote(ids.C!, ids.C!);
    engine.castDayVote(ids.D!, ids.D!);
    // C: A,C = 2; D: B,D = 2 -> tie, round 1.
    const outcome = engine.tallyDayVoteAndProceed();
    expect(outcome.awaitingAnotherRound).toBe(true);
    expect(engine.getPublicState().phase).toBe("TIE_DEFENSE");
    // Votes are never exposed outside the DAY_VOTE phase itself, even
    // though the underlying round-1 votes are still held internally.
    expect(engine.getPublicState().dayVotes).toEqual({});

    engine.endTieDefense();
    expect(engine.getPublicState().phase).toBe("DAY_VOTE");
    // Back in DAY_VOTE (round 2): live votes are visible again.
    expect(engine.getPublicState().dayVotes).not.toEqual({});
  });
});
