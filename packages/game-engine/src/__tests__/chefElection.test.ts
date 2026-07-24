import { describe, expect, it } from "vitest";
import { makeGameWithPlayers } from "./helpers";

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
    engine.endDay1Discussion();
    engine.resolveNightAndProceed(); // no actions submitted -> nobody dies
    engine.proceedFromMorningToDay();
    engine.endDayDiscussion();

    // 8 alive, threshold 6 -> Chef (A) still worth 2 votes. A votes for H,
    // three others vote for G: without the bonus it would tie 3-3-1(H has A's
    // own vote at weight 1) -> with the bonus H wins outright at 2 vs 3... so
    // instead prove the bonus directly: A + one other vote for H (2+1=3)
    // beats three votes for G (3) only if bonus makes it not a tie -> use a
    // clean 2-voter H vs 3-voter G split where the bonus flips the result.
    engine.castDayVote(playerIds.A!, playerIds.H!); // Chef vote = weight 2
    engine.castDayVote(playerIds.B!, playerIds.G!);
    engine.castDayVote(playerIds.C!, playerIds.G!);
    const outcome = engine.tallyDayVoteAndProceed();

    // H: 2 (chef bonus). G: 2 (B + C). Tie expected -> proves the bonus
    // actually applied (without it, H would have only 1 vote and G would win outright).
    expect(outcome.tie).toBe(true);
    expect(outcome.tiedIds.sort()).toEqual([playerIds.G, playerIds.H].sort());
  });
});
