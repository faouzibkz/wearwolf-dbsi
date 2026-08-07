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
  engine.resolveNightAndProceed(); // nobody targeted, nobody dies
  engine.proceedFromMorningToDay();
  engine.endDayDiscussion();
  return { engine, ids };
}

describe("day vote is a live, open ballot", () => {
  it("exposes every cast vote (voterId -> targetId) during DAY_VOTE, live as votes come in, and locks each vote after it's cast", () => {
    const names = ["A", "B", "C", "D", "E"];
    const { engine, ids } = bootToDayVote(names, 5);

    expect(engine.getPublicState().dayVotes).toEqual({});

    // The vote is now a turn queue, not a free-for-all — ask the engine
    // who's actually up rather than assuming it's A, then B.
    const voter1 = engine.getCurrentDayVoterId()!;
    engine.castDayVote(voter1, ids.C!);
    expect(engine.getPublicState().dayVotes).toEqual({ [voter1]: ids.C! });

    const voter2 = engine.getCurrentDayVoterId()!;
    engine.castDayVote(voter2, ids.C!);
    expect(engine.getPublicState().dayVotes).toEqual({ [voter1]: ids.C!, [voter2]: ids.C! });

    // One vote per player per round, locked — no changing your mind once
    // cast (prevents last-second bandwagon flips / rage-clicking). Also no
    // longer this voter's turn, which throws for the same reason.
    expect(() => engine.castDayVote(voter1, ids.D!)).toThrow();
    expect(engine.getPublicState().dayVotes).toEqual({ [voter1]: ids.C!, [voter2]: ids.C! });
  });

  it("rejects a vote cast out of turn", () => {
    const names = ["A", "B", "C", "D", "E"];
    const { engine, ids } = bootToDayVote(names, 5);

    const current = engine.getCurrentDayVoterId()!;
    const outOfTurnVoter = names.map((n) => ids[n]!).find((id) => id !== current)!;
    expect(() => engine.castDayVote(outOfTurnVoter, ids.C!)).toThrow(/tour/);
  });

  it("never leaks votes outside the DAY_VOTE phase (not during TIE_DEFENSE, not after resolution)", () => {
    const names = ["A", "B", "C", "D", "E"];
    const { engine, ids } = bootToDayVote(names, 5);

    // C: A,C,E = 3 votes; D: B,D = 2 votes -> no tie, C is eliminated.
    // Casting the last (Chef-equivalent, here just the queue's final) turn
    // auto-triggers the tally, so the outcome comes back from
    // castDayVotesInOrder itself rather than a separate tallyDayVoteAndProceed() call.
    const outcome = castDayVotesInOrder(engine, {
      [ids.A!]: ids.C!,
      [ids.B!]: ids.D!,
      [ids.C!]: ids.C!,
      [ids.D!]: ids.D!,
      [ids.E!]: ids.C!,
    });

    expect(outcome?.eliminatedId).toBe(ids.C);
    // We're in DAY_VOTE_RESULT now (the announcement pause before night
    // falls) — no stale votes should still be exposed.
    expect(engine.getPublicState().dayVotes).toEqual({});
  });

  it("is hidden during TIE_DEFENSE and round 2 opens with a CLEAN ballot, not round 1's stale votes", () => {
    const names = ["A", "B", "C", "D"];
    const { engine, ids } = bootToDayVote(names, 9);

    // C: A,C = 2; D: B,D = 2 -> tie, round 1.
    const outcome = castDayVotesInOrder(engine, {
      [ids.A!]: ids.C!,
      [ids.B!]: ids.D!,
      [ids.C!]: ids.C!,
      [ids.D!]: ids.D!,
    });
    expect(outcome?.awaitingAnotherRound).toBe(true);
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
    const voter = engine.getCurrentDayVoterId()!;
    engine.castDayVote(voter, ids.C!);
    expect(engine.getPublicState().dayVotes).toEqual({ [voter]: ids.C! });
  });
});

describe("Chef's vote weight in the live tally", () => {
  it("counts the Chef's vote as 2 while the bonus is active (alive count > threshold)", () => {
    // 7 players, default chefVoteBonusThreshold is 6 -> bonus active (7 > 6).
    const names = ["Chef", "B", "C", "D", "E", "F", "G"];
    const { engine, ids } = bootToDayVote(names, 3);

    // D gets two unweighted votes (weight 2). The Chef votes alone for E —
    // if the bonus is active, that single vote counts as weight 2 too,
    // producing a tie; if it only counted as 1, E would simply lose. F and
    // G don't vote (timeout). Order doesn't matter here — castDayVotesInOrder
    // walks whoever's turn it actually is regardless of map key order.
    const outcome = castDayVotesInOrder(engine, {
      [ids.B!]: ids.D!,
      [ids.C!]: ids.D!,
      [ids.Chef!]: ids.E!,
    });

    expect(outcome?.tie).toBe(true);
    expect(new Set(outcome?.tiedIds)).toEqual(new Set([ids.D!, ids.E!]));
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

    const votesByVoterId: Record<string, string> = {};
    for (const n of names) {
      const voterId = ids[n]!;
      if (voterId !== targetId) votesByVoterId[voterId] = targetId;
    }
    const roundOneOutcome = castDayVotesInOrder(engine, votesByVoterId);
    expect(roundOneOutcome?.eliminatedId).toBe(targetId);

    engine.proceedFromDayVoteResultToNight();
    engine.resolveNightAndProceed();
    engine.proceedFromMorningToDay();
    engine.endDayDiscussion();

    // 6 alive now, exactly at chefVoteBonusThreshold -> bonus inactive.
    // Two non-Chef players give a third player a clean weight-2 vote; the
    // Chef votes alone for a fourth player. If the bonus were still active
    // that would tie (2 vs 2); since it's inactive the Chef's pick only
    // reaches weight 1 and the other target wins outright instead.
    const aliveNonChef = names.map((n) => ids[n]!).filter((id) => id !== targetId && id !== ids.Chef);
    const [voterX, voterY, otherTargetId, nextTargetId] = aliveNonChef;

    const round2Outcome = castDayVotesInOrder(engine, {
      [voterX!]: otherTargetId!,
      [voterY!]: otherTargetId!,
      [ids.Chef!]: nextTargetId!,
    });

    expect(round2Outcome?.tie).toBe(false);
    expect(round2Outcome?.eliminatedId).toBe(otherTargetId);
  });
});
