import { describe, expect, it } from "vitest";
import { castDayVotesInOrder, makeGameWithPlayers } from "./helpers";

describe("Chef du village election", () => {
  it("caps candidates at 3 and lets the admin force the debate to start", () => {
    const { engine, playerIds } = makeGameWithPlayers(["A", "B", "C", "D", "E"]);
    engine.startGame();

    engine.volunteerForChef(playerIds.A!);
    engine.volunteerForChef(playerIds.B!);
    engine.volunteerForChef(playerIds.C!);
    expect(() => engine.volunteerForChef(playerIds.D!)).toThrow();

    engine.forceStartChefDebate();
    expect(engine.getPhase()).toBe("CHEF_DEBATE");
  });

  it("prevents candidates from voting and elects the top vote-getter", () => {
    const { engine, playerIds } = makeGameWithPlayers(["A", "B", "C", "D", "E"]);
    engine.startGame();
    engine.volunteerForChef(playerIds.A!);
    engine.volunteerForChef(playerIds.B!);
    engine.forceStartChefDebate();
    engine.advanceChefSpeaker();
    engine.advanceChefSpeaker(); // done -> CHEF_VOTE

    expect(() => engine.castChefVote(playerIds.A!, playerIds.B!)).toThrow();

    engine.castChefVote(playerIds.C!, playerIds.A!);
    engine.castChefVote(playerIds.D!, playerIds.A!);
    engine.castChefVote(playerIds.E!, playerIds.B!);
    const electedId = engine.tallyChefVoteAndProceed();
    expect(engine.getPhase()).toBe("CHEF_REVEAL");
    engine.proceedFromChefRevealToDiscussion();

    expect(electedId).toBe(playerIds.A);
    expect(engine.getPhase()).toBe("DAY_1_DISCUSSION");
    expect(engine.getPublicState().chefId).toBe(playerIds.A);
  });

  it("gives the Chef's vote double weight until 6 players remain", () => {
    const names = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const { engine, playerIds } = makeGameWithPlayers(names, {
      roleCounts: { LOUP_GAROU: 1 },
      chefVoteBonusThreshold: 6,
    });
    engine.startGame();
    engine.volunteerForChef(playerIds.A!);
    engine.forceStartChefDebate();
    engine.advanceChefSpeaker();
    for (const n of ["B", "C", "D", "E", "F", "G", "H"]) engine.castChefVote(playerIds[n]!, playerIds.A!);
    engine.tallyChefVoteAndProceed();
    engine.proceedFromChefRevealToDiscussion();
    engine.endDay1Discussion();
    engine.resolveNightAndProceed(); // no actions submitted -> nobody dies
    engine.proceedFromMorningToDay();
    engine.endDayDiscussion();

    // 8 alive, threshold 6 -> Chef (A) still worth 2 votes. The Chef always
    // votes last in the turn queue, so cast B and C's votes for G (weight 2)
    // and the Chef's own vote for H — castDayVotesInOrder walks whoever's
    // turn it actually is, in whatever order the queue puts them in.
    const outcome = castDayVotesInOrder(engine, {
      [playerIds.B!]: playerIds.G!,
      [playerIds.C!]: playerIds.G!,
      [playerIds.A!]: playerIds.H!, // Chef vote = weight 2
    });

    // H: 2 (chef bonus). G: 2 (B + C). Tie expected -> proves the bonus
    // actually applied (without it, H would have only 1 vote and G would win outright).
    expect(outcome?.tie).toBe(true);
    expect(outcome?.tiedIds.slice().sort()).toEqual([playerIds.G, playerIds.H].sort());
  });
});
