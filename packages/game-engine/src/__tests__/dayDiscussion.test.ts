import { describe, expect, it } from "vitest";
import { GameEngine } from "../engine/GameEngine";
import { seededRng } from "./helpers";

function bootWithElectedChef(names: string[], roleCounts: Record<string, number>, seed: number) {
  const engine = GameEngine.createGame({ roleCounts: roleCounts as any }, seededRng(seed));
  const ids: Record<string, string> = {};
  for (const n of names) ids[n] = engine.addPlayer(n).id;
  engine.startGame();
  engine.volunteerForChef(ids[names[0]!]!);
  engine.forceStartChefDebate();
  engine.advanceChefSpeaker();
  for (const n of names.slice(1)) engine.castChefVote(ids[n]!, ids[names[0]!]!);
  engine.tallyChefVoteAndProceed(); // names[0] is elected Chef, phase -> CHEF_REVEAL
  engine.proceedFromChefRevealToDiscussion(); // -> DAY_1_DISCUSSION
  return { engine, ids };
}

describe("Day discussion speaking order", () => {
  it("puts the Chef first and last, everyone else once in between", () => {
    const names = ["Chef", "B", "C", "D", "E"];
    const { engine, ids } = bootWithElectedChef(names, { LOUP_GAROU: 1 }, 1);

    expect(engine.getPhase()).toBe("DAY_1_DISCUSSION");
    const order = engine.getPublicState().dayDiscussionOrder!;

    expect(order[0]).toBe(ids.Chef);
    expect(order[order.length - 1]).toBe(ids.Chef);
    expect(order).toHaveLength(names.length + 1); // Chef counted twice
    // Everyone else appears exactly once, somewhere in the middle.
    for (const n of names) {
      if (n === "Chef") continue;
      expect(order.filter((id) => id === ids[n]).length).toBe(1);
    }
    expect(engine.getCurrentDaySpeakerId()).toBe(ids.Chef);
  });

  it("advances speaker by speaker and auto-transitions to NIGHT once the Chef's closing turn ends (day 1)", () => {
    const names = ["Chef", "B", "C", "D", "E"];
    const { engine, ids } = bootWithElectedChef(names, { LOUP_GAROU: 1 }, 1);
    const order = engine.getPublicState().dayDiscussionOrder!;

    // order.length turns total: index starts at 0 (first turn already
    // active), so it takes exactly order.length advance() calls to walk
    // through every turn and close out the last one (the Chef's second turn).
    for (let i = 1; i <= order.length; i++) {
      const result = engine.advanceDaySpeaker();
      if (i < order.length) {
        expect(result.done).toBe(false);
        expect(engine.getCurrentDaySpeakerId()).toBe(order[i]);
        expect(engine.getPhase()).toBe("DAY_1_DISCUSSION");
      } else {
        expect(result.done).toBe(true);
        expect(engine.getPhase()).toBe("NIGHT"); // auto-advanced, no manual endDay1Discussion() needed
      }
    }
  });

  it("manual endDay1Discussion() still works as a skip-ahead regardless of queue position", () => {
    const names = ["Chef", "B", "C", "D", "E"];
    const { engine } = bootWithElectedChef(names, { LOUP_GAROU: 1 }, 1);
    engine.advanceDaySpeaker(); // only one speaker in
    engine.endDay1Discussion();
    expect(engine.getPhase()).toBe("NIGHT");
  });

  it("rebuilds a fresh order for DAY_DISCUSSION on later days, excluding anyone who died overnight", () => {
    const names = ["Chef", "B", "C", "D", "E"];
    const { engine, ids } = bootWithElectedChef(names, { LOUP_GAROU: 1 }, 1);
    engine.endDay1Discussion(); // -> NIGHT

    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    const victim = names.find((n) => n !== wolf && n !== "Chef")!;

    engine.submitNightAction(ids[wolf]!, "KILL_VOTE", ids[victim]!);
    engine.resolveNightAndProceed(); // -> MORNING
    engine.proceedFromMorningToDay(); // -> DAY_DISCUSSION, new order built

    expect(engine.getPhase()).toBe("DAY_DISCUSSION");
    const order = engine.getPublicState().dayDiscussionOrder!;
    expect(order).not.toContain(ids[victim]);
    expect(order[0]).toBe(ids.Chef);
    expect(order[order.length - 1]).toBe(ids.Chef);
    // 5 players, 1 dead overnight -> 4 alive -> 3 non-Chef others + Chef
    // counted twice = 5 = names.length (one fewer than the 6-turn full-cast
    // order from the first test).
    expect(order).toHaveLength(names.length);
  });

  it("auto-transitions DAY_DISCUSSION -> DAY_VOTE once the Chef's closing turn ends", () => {
    const names = ["Chef", "B", "C", "D", "E"];
    const { engine } = bootWithElectedChef(names, { LOUP_GAROU: 1 }, 1);
    engine.endDay1Discussion();
    engine.resolveNightAndProceed();
    engine.proceedFromMorningToDay();

    const order = engine.getPublicState().dayDiscussionOrder!;
    for (let i = 1; i <= order.length; i++) engine.advanceDaySpeaker();

    expect(engine.getPhase()).toBe("DAY_VOTE");
  });

  it("rejects advanceDaySpeaker() outside a discussion phase", () => {
    const names = ["Chef", "B", "C", "D", "E"];
    const { engine } = bootWithElectedChef(names, { LOUP_GAROU: 1 }, 1);
    engine.endDay1Discussion(); // -> NIGHT
    expect(() => engine.advanceDaySpeaker()).toThrow();
  });
});
