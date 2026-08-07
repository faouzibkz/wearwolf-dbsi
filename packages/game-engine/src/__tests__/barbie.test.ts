import { describe, expect, it } from "vitest";
import { GameEngine } from "../engine/GameEngine";
import { seededRng } from "./helpers";

function bootToDay1Discussion(seed: number, roleCounts: Record<string, number>, names: string[]) {
  const engine = GameEngine.createGame({ roleCounts: roleCounts as any }, seededRng(seed));
  const ids: Record<string, string> = {};
  for (const n of names) ids[n] = engine.addPlayer(n).id;
  engine.startGame();
  const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
  engine.volunteerForChef(ids[names[0]!]!);
  engine.forceStartChefDebate();
  engine.advanceChefSpeaker();
  for (const n of names.slice(1)) engine.castChefVote(ids[n]!, ids[names[0]!]!);
  engine.tallyChefVoteAndProceed();
  engine.proceedFromChefRevealToDiscussion(); // -> DAY_1_DISCUSSION
  return { engine, ids, roles };
}

describe("Barbie", () => {
  it("unmasking a wolf kills the wolf and installs Barbie as Chef, replacing whoever held it", () => {
    const names = ["Chef", "Barbie", "LoupGarou", "V1", "V2"];
    const { engine, ids, roles } = bootToDay1Discussion(5, { LOUP_GAROU: 1, BARBIE: 1 }, names);
    const barbieId = names.find((n) => roles.get(ids[n]!) === "BARBIE")!;
    const wolfId = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    const oldChefId = engine.getChefId()!;

    expect(engine.canBarbieUsePower(ids[barbieId]!)).toBe(true);
    const outcome = engine.useBarbiePower(ids[barbieId]!, ids[wolfId]!);

    expect(outcome.outcome).toBe("WOLF_DIED_BARBIE_CHEF");
    expect(outcome.newChefId).toBe(ids[barbieId]!);
    expect(engine.getPublicState().players.find((p) => p.id === ids[wolfId]!)!.isAlive).toBe(false);
    expect(engine.getPublicState().players.find((p) => p.id === ids[barbieId]!)!.isChef).toBe(true);
    expect(engine.getPublicState().players.find((p) => p.id === oldChefId)!.isChef).toBe(false);
    expect(engine.getChefId()).toBe(ids[barbieId]!);
    // One-shot: can't be used again.
    expect(engine.canBarbieUsePower(ids[barbieId]!)).toBe(false);
  });

  it("unmasking anyone else (non-wolf) kills both Barbie and the target", () => {
    const names = ["Chef", "Barbie", "LoupGarou", "V1", "V2"];
    const { engine, ids, roles } = bootToDay1Discussion(5, { LOUP_GAROU: 1, BARBIE: 1 }, names);
    const barbieId = names.find((n) => roles.get(ids[n]!) === "BARBIE")!;
    const villagerId = names.find(
      (n) => roles.get(ids[n]!) !== "BARBIE" && roles.get(ids[n]!) !== "LOUP_GAROU",
    )!;

    const outcome = engine.useBarbiePower(ids[barbieId]!, ids[villagerId]!);
    expect(outcome.outcome).toBe("BOTH_DIED");
    expect(outcome.newChefId).toBeNull();
    expect(engine.getPublicState().players.find((p) => p.id === ids[barbieId]!)!.isAlive).toBe(false);
    expect(engine.getPublicState().players.find((p) => p.id === ids[villagerId]!)!.isAlive).toBe(false);
  });

  it("unmasking the Alien kills both Barbie and the Alien (treated like any non-wolf)", () => {
    const names = ["Chef", "Barbie", "Alien", "V1", "V2"];
    const { engine, ids, roles } = bootToDay1Discussion(5, { ALIEN: 1, BARBIE: 1 }, names);
    const barbieId = names.find((n) => roles.get(ids[n]!) === "BARBIE")!;
    const alienId = names.find((n) => roles.get(ids[n]!) === "ALIEN")!;

    const outcome = engine.useBarbiePower(ids[barbieId]!, ids[alienId]!);
    expect(outcome.outcome).toBe("BOTH_DIED");
    expect(engine.getPublicState().players.find((p) => p.id === ids[alienId]!)!.isAlive).toBe(false);
    expect(engine.getPublicState().players.find((p) => p.id === ids[barbieId]!)!.isAlive).toBe(false);
  });

  it("cannot target herself and cannot be used twice (a dead Barbie can't act again either)", () => {
    const names = ["Chef", "Barbie", "LoupGarou", "V1", "V2"];
    const { engine, ids, roles } = bootToDay1Discussion(5, { LOUP_GAROU: 1, BARBIE: 1 }, names);
    const barbieId = names.find((n) => roles.get(ids[n]!) === "BARBIE")!;
    const villagerId = names.find(
      (n) => roles.get(ids[n]!) !== "BARBIE" && roles.get(ids[n]!) !== "LOUP_GAROU",
    )!;
    const anotherVillagerId = names.find(
      (n) =>
        roles.get(ids[n]!) !== "BARBIE" &&
        roles.get(ids[n]!) !== "LOUP_GAROU" &&
        n !== villagerId,
    )!;

    expect(() => engine.useBarbiePower(ids[barbieId]!, ids[barbieId]!)).toThrow();
    engine.useBarbiePower(ids[barbieId]!, ids[villagerId]!); // she dies here (BOTH_DIED)
    // Both the "already used" guard and "she's dead" now agree — this must throw.
    expect(() => engine.useBarbiePower(ids[barbieId]!, ids[anotherVillagerId]!)).toThrow();
  });

  it("resumes discussion with whoever's next after removing the casualty from the speaking queue", () => {
    const names = ["Chef", "Barbie", "LoupGarou", "V1", "V2"];
    const { engine, ids, roles } = bootToDay1Discussion(5, { LOUP_GAROU: 1, BARBIE: 1 }, names);
    const barbieId = names.find((n) => roles.get(ids[n]!) === "BARBIE")!;
    const villagerId = names.find(
      (n) => roles.get(ids[n]!) !== "BARBIE" && roles.get(ids[n]!) !== "LOUP_GAROU",
    )!;

    expect(engine.getPhase()).toBe("DAY_1_DISCUSSION");
    engine.useBarbiePower(ids[barbieId]!, ids[villagerId]!); // BOTH_DIED — Barbie herself is gone
    // Discussion should still be going (not everyone died), just missing the two casualties.
    expect(engine.getPhase()).toBe("DAY_1_DISCUSSION");
    const order = engine.getPublicState().dayDiscussionOrder!;
    expect(order).not.toContain(ids[barbieId]!);
    expect(order).not.toContain(ids[villagerId]!);
  });

  it("a Barbie-installed Chef speaks last exactly once, without the deposed Chef getting a second turn", () => {
    // Two wolves so unmasking one doesn't instantly end the game (see the
    // dedicated "can end the game outright" test below for that case) —
    // this test is purely about the speaking-queue surgery.
    const names = ["Chef", "Barbie", "Wolf1", "Wolf2", "V1", "V2"];
    const { engine, ids, roles } = bootToDay1Discussion(5, { LOUP_GAROU: 2, BARBIE: 1 }, names);
    const barbieId = names.find((n) => roles.get(ids[n]!) === "BARBIE")!;
    const wolfId = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    const oldChefId = engine.getChefId()!;

    engine.useBarbiePower(ids[barbieId]!, ids[wolfId]!);
    expect(engine.getPhase()).not.toBe("ENDED"); // one wolf remains — game continues
    const order = engine.getPublicState().dayDiscussionOrder!;
    // The old Chef's remaining (closing) slot is gone — replaced by exactly
    // one guaranteed final turn for Barbie.
    expect(order.filter((id) => id === oldChefId).length).toBe(0);
    expect(order.filter((id) => id === ids[barbieId]!).length).toBe(1);
    expect(order[order.length - 1]).toBe(ids[barbieId]!);

    // Walk discussion to the end — day 1 has no vote/second-debate, so this
    // should land straight in NIGHT once Barbie's single closing turn ends.
    let done = false;
    while (!done) {
      done = engine.advanceDaySpeaker().done;
    }
    expect(engine.getPhase()).toBe("NIGHT");
  });

  it("can end the game outright if the unmasked wolf was the last one alive", () => {
    const names = ["Chef", "Barbie", "LoupGarou", "V1", "V2"];
    const { engine, ids, roles } = bootToDay1Discussion(5, { LOUP_GAROU: 1, BARBIE: 1 }, names);
    const barbieId = names.find((n) => roles.get(ids[n]!) === "BARBIE")!;
    const wolfId = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;

    engine.useBarbiePower(ids[barbieId]!, ids[wolfId]!);
    expect(engine.getPhase()).toBe("ENDED");
    expect(engine.getPublicState().winner).toBe("VILLAGE");
  });

  it("if the unmasked wolf happened to be the sitting Chef, no dangling succession blocker is left behind", () => {
    const names = ["Barbie", "LoupGarou", "V1", "V2", "V3"];
    const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1, BARBIE: 1 } }, seededRng(5));
    const ids: Record<string, string> = {};
    for (const n of names) ids[n] = engine.addPlayer(n).id;
    engine.startGame();
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolfId = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    const barbieId = names.find((n) => roles.get(ids[n]!) === "BARBIE")!;

    // Elect the wolf himself as Chef, specifically to test this edge case.
    engine.volunteerForChef(ids[wolfId]!);
    engine.forceStartChefDebate();
    engine.advanceChefSpeaker();
    for (const n of names) if (n !== wolfId) engine.castChefVote(ids[n]!, ids[wolfId]!);
    engine.tallyChefVoteAndProceed();
    engine.proceedFromChefRevealToDiscussion();

    expect(engine.getChefId()).toBe(ids[wolfId]!);
    engine.useBarbiePower(ids[barbieId]!, ids[wolfId]!);
    // Barbie takes over directly — no pending Chef succession left dangling.
    expect(engine.getPendingChefSuccessionDeadChefId()).toBeNull();
    expect(engine.getChefId()).toBe(ids[barbieId]!);
  });
});
