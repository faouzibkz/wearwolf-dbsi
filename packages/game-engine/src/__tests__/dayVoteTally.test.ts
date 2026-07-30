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
  engine.proceedFromChefRevealToDiscussion();
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
    // We're in DAY_VOTE_RESULT now (the announcement pause before night
    // falls) — no stale votes should still be exposed.
    expect(engine.getPublicState().dayVotes).toEqual({});
  });

  it("is hidden during TIE_DEFENSE and round 2 opens with a CLEAN ballot, not round 1's stale votes", () => {
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
    expect(engine.getPublicState().dayVotes).toEqual({});

    engine.endTieDefense();
    expect(engine.getPublicState().phase).toBe("DAY_VOTE");
    // Back in DAY_VOTE (round 2): the ballot is freshly EMPTY, not still
    // showing round 1's votes — a tied player who doesn't recast must not
    // have their old vote silently carried over into the re-vote.
    expect(engine.getPublicState().dayVotes).toEqual({});
    expect(engine.getPublicState().dayVoteTally).toEqual({});

    // Once someone actually casts a round-2 vote, it shows up normally.
    engine.castDayVote(ids.A!, ids.C!);
    expect(engine.getPublicState().dayVotes).toEqual({ [ids.A!]: ids.C! });
  });
});

describe("Chef's vote weight in the live tally", () => {
  it("counts the Chef's vote as 2 while the bonus is active (alive count > threshold)", () => {
    // 7 players, default chefVoteBonusThreshold is 6 -> bonus active (7 > 6).
    const names = ["Chef", "B", "C", "D", "E", "F", "G"];
    const { engine, ids } = bootToDayVote(names, 3);

    engine.castDayVote(ids.Chef!, ids.C!);
    expect(engine.getPublicState().dayVoteTally).toEqual({ [ids.C!]: 2 });
    // Raw voter list still shows just the one voter — the "2" is weight,
    // not a phantom second voter.
    expect(engine.getPublicState().dayVotes).toEqual({ [ids.Chef!]: ids.C! });

    engine.castDayVote(ids.B!, ids.C!);
    expect(engine.getPublicState().dayVoteTally).toEqual({ [ids.C!]: 3 }); // 2 (Chef) + 1 (B)
  });

  it("drops the Chef's vote back to weight 1 once alive count falls to the threshold", () => {
    const names = ["Chef", "B", "C", "D", "E", "F", "G"];
    const { engine, ids } = bootToDayVote(names, 3);
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolfId = [...roles.entries()].find(([, r]) => r === "LOUP_GAROU")![0];
    // Eliminate someone who isn't the Chef or the wolf, so the game keeps
    // going and alive count simply drops from 7 to 6 (== threshold, bonus
    // requires strictly > threshold so it should now be inactive).
    const targetId = names.map((n) => ids[n]!).find((id) => id !== ids.Chef && id !== wolfId)!;

    for (const n of names) {
      const voterId = ids[n]!;
      if (voterId !== targetId) engine.castDayVote(voterId, targetId);
    }
    const outcome = engine.tallyDayVoteAndProceed();
    expect(outcome.eliminatedId).toBe(targetId);

    engine.proceedFromDayVoteResultToNight();
    engine.resolveNightAndProceed();
    engine.proceedFromMorningToDay();
    engine.endDayDiscussion();

    const nextTargetId = names.map((n) => ids[n]!).find((id) => id !== ids.Chef && id !== targetId)!;
    engine.castDayVote(ids.Chef!, nextTargetId);
    expect(engine.getPublicState().dayVoteTally).toEqual({ [nextTargetId]: 1 });
  });
});
