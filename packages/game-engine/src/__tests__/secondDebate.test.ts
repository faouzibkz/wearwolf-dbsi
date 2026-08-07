import { describe, expect, it } from "vitest";
import { GameEngine } from "../engine/GameEngine";
import { castDayVotesInOrder, seededRng } from "./helpers";

/** Boots straight to DAY_DISCUSSION on day 2 (an uneventful night 1 first). */
function bootToDay2Discussion(seed: number, names: string[]) {
  const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1 } }, seededRng(seed));
  const ids: Record<string, string> = {};
  for (const n of names) ids[n] = engine.addPlayer(n).id;
  engine.startGame();
  engine.volunteerForChef(ids[names[0]!]!);
  engine.forceStartChefDebate();
  engine.advanceChefSpeaker();
  for (const n of names.slice(1)) engine.castChefVote(ids[n]!, ids[names[0]!]!);
  engine.tallyChefVoteAndProceed();
  engine.proceedFromChefRevealToDiscussion(); // -> DAY_1_DISCUSSION
  engine.endDay1Discussion(); // -> NIGHT 1
  engine.resolveNightAndProceed(); // nobody acted -> MORNING, no death
  engine.proceedFromMorningToDay(); // -> DAY_DISCUSSION (day 2)
  return { engine, ids };
}

function finishDiscussion(engine: GameEngine) {
  let done = false;
  while (!done) done = engine.advanceDaySpeaker().done;
}

describe("Chef's second debate", () => {
  it("only exists after DAY_DISCUSSION (day 2+), never after DAY_1_DISCUSSION", () => {
    const names = ["Chef", "A", "B", "C"];
    const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1 } }, seededRng(1));
    const ids: Record<string, string> = {};
    for (const n of names) ids[n] = engine.addPlayer(n).id;
    engine.startGame();
    engine.volunteerForChef(ids[names[0]!]!);
    engine.forceStartChefDebate();
    engine.advanceChefSpeaker();
    for (const n of names.slice(1)) engine.castChefVote(ids[n]!, ids[names[0]!]!);
    engine.tallyChefVoteAndProceed();
    engine.proceedFromChefRevealToDiscussion();

    finishDiscussion(engine);
    expect(engine.getPhase()).toBe("NIGHT"); // day 1 has no vote and no second debate
  });

  it("naturally transitions DAY_DISCUSSION -> CHEF_SECOND_DEBATE (choice pending) once discussion ends", () => {
    const names = ["Chef", "A", "B", "C"];
    const { engine } = bootToDay2Discussion(1, names);
    finishDiscussion(engine);
    expect(engine.getPhase()).toBe("CHEF_SECOND_DEBATE");
    expect(engine.isSecondDebateChoicePending()).toBe(true);
  });

  it("the Chef choosing nobody moves straight on to DAY_VOTE", () => {
    const names = ["Chef", "A", "B", "C"];
    const { engine } = bootToDay2Discussion(1, names);
    finishDiscussion(engine);
    engine.chooseSecondDebateSpeakers([]);
    expect(engine.getPhase()).toBe("DAY_VOTE");
  });

  it("the Chef choosing 2 speakers gives them each exactly one bonus turn before DAY_VOTE opens", () => {
    const names = ["Chef", "A", "B", "C"];
    const { engine, ids } = bootToDay2Discussion(1, names);
    finishDiscussion(engine);

    const eligible = engine.getSecondDebateEligibleTargets();
    expect(eligible).not.toContain(engine.getChefId()); // the Chef can't pick himself
    const [first, second] = eligible;
    engine.chooseSecondDebateSpeakers([first!, second!]);
    expect(engine.isSecondDebateChoicePending()).toBe(false);
    expect(engine.getCurrentSecondDebateSpeakerId()).toBe(first);

    let result = engine.advanceSecondDebateSpeaker();
    expect(result.done).toBe(false);
    expect(engine.getCurrentSecondDebateSpeakerId()).toBe(second);
    expect(engine.getPhase()).toBe("CHEF_SECOND_DEBATE");

    result = engine.advanceSecondDebateSpeaker();
    expect(result.done).toBe(true);
    expect(engine.getPhase()).toBe("DAY_VOTE");
    void ids;
  });

  it("rejects choosing more than secondDebateSlots players", () => {
    const names = ["Chef", "A", "B", "C", "D"];
    const engine = GameEngine.createGame(
      { roleCounts: { LOUP_GAROU: 1 }, secondDebateSlots: 1 },
      seededRng(1),
    );
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
    finishDiscussion(engine);

    const eligible = engine.getSecondDebateEligibleTargets();
    expect(() => engine.chooseSecondDebateSpeakers(eligible.slice(0, 2))).toThrow();
  });

  it("rejects choosing the same player twice, or the Chef himself", () => {
    const names = ["Chef", "A", "B", "C"];
    const { engine } = bootToDay2Discussion(1, names);
    finishDiscussion(engine);
    const eligible = engine.getSecondDebateEligibleTargets();
    expect(() => engine.chooseSecondDebateSpeakers([eligible[0]!, eligible[0]!])).toThrow();
    expect(() => engine.chooseSecondDebateSpeakers([engine.getChefId()!])).toThrow();
  });

  it("the choice can only be made once per CHEF_SECOND_DEBATE phase", () => {
    const names = ["Chef", "A", "B", "C"];
    const { engine } = bootToDay2Discussion(1, names);
    finishDiscussion(engine);
    engine.chooseSecondDebateSpeakers([]);
    expect(() => engine.chooseSecondDebateSpeakers([])).toThrow();
  });

  it("endChefSecondDebate() force-skips straight to DAY_VOTE, whether or not the Chef has chosen yet", () => {
    const names = ["Chef", "A", "B", "C"];
    const { engine } = bootToDay2Discussion(1, names);
    finishDiscussion(engine);
    expect(engine.isSecondDebateChoicePending()).toBe(true);
    engine.endChefSecondDebate();
    expect(engine.getPhase()).toBe("DAY_VOTE");
  });

  it("endDayDiscussion() (manual force-skip) bypasses the second debate entirely", () => {
    const names = ["Chef", "A", "B", "C"];
    const { engine } = bootToDay2Discussion(1, names);
    engine.endDayDiscussion(); // skip ahead mid-discussion
    expect(engine.getPhase()).toBe("DAY_VOTE");
  });

  it("the day vote still works normally after a second debate round", () => {
    const names = ["Chef", "A", "B", "C"];
    const { engine, ids } = bootToDay2Discussion(1, names);
    finishDiscussion(engine);
    engine.chooseSecondDebateSpeakers([]);
    expect(engine.getPhase()).toBe("DAY_VOTE");

    const alive = engine.getPublicState().players.filter((p) => p.isAlive).map((p) => p.id);
    const votes: Record<string, string> = {};
    for (const id of alive) votes[id] = ids.A!;
    const outcome = castDayVotesInOrder(engine, votes);
    expect(outcome?.eliminatedId).toBe(ids.A);
  });
});
