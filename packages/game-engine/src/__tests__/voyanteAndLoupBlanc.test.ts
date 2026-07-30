import { describe, expect, it } from "vitest";
import { GameEngine } from "../engine/GameEngine";
import { seededRng } from "./helpers";

function bootToNight1(names: string[], roleCounts: Record<string, number>, seed: number) {
  const engine = GameEngine.createGame({ roleCounts: roleCounts as any }, seededRng(seed));
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
  return { engine, ids };
}

describe("Voyante inspection result delivery", () => {
  it("returns the result of the Voyante's own most recent inspection, and nobody else's", () => {
    const names = ["A", "B", "C", "D", "E"];
    const { engine, ids } = bootToNight1(names, { LOUP_GAROU: 1, VOYANTE: 1 }, 7);
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const voyante = names.find((n) => roles.get(ids[n]!) === "VOYANTE")!;
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    const villager = names.find((n) => n !== voyante && n !== wolf)!;

    engine.submitNightAction(ids[voyante]!, "INSPECT", ids[wolf]!);
    const result = engine.getLastVoyanteResult(ids[voyante]!);
    expect(result).toMatchObject({ targetId: ids[wolf], targetNickname: wolf, result: "LOUP" });

    // A non-Voyante querying (or before anyone has inspected) gets nothing.
    expect(engine.getLastVoyanteResult(ids[villager]!)).toBeNull();
  });

  it("Loup Garou always reads as LOUP on the very first inspection", () => {
    const names = ["A", "B", "C", "D", "E"];
    const { engine, ids } = bootToNight1(names, { LOUP_GAROU: 1, VOYANTE: 1 }, 7);
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const voyante = names.find((n) => roles.get(ids[n]!) === "VOYANTE")!;
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;

    engine.submitNightAction(ids[voyante]!, "INSPECT", ids[wolf]!);
    expect(engine.getLastVoyanteResult(ids[voyante]!)?.result).toBe("LOUP");
  });
});

describe("Loup Blanc house rule: cover holds on first inspection, breaks on second", () => {
  it("shows NON_LOUP the first time the Voyante checks the Loup Blanc, then LOUP on a second check", () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    const { engine, ids } = bootToNight1(names, { LOUP_GAROU: 1, LOUP_BLANC: 1, VOYANTE: 1 }, 11);
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const voyante = names.find((n) => roles.get(ids[n]!) === "VOYANTE")!;
    const loupBlanc = names.find((n) => roles.get(ids[n]!) === "LOUP_BLANC")!;
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    const bystander = names.find(
      (n) => n !== voyante && n !== loupBlanc && n !== wolf && roles.get(ids[n]!) === "VILLAGEOIS",
    )!;

    // First inspection ever of the Loup Blanc -> his cover holds.
    engine.submitNightAction(ids[voyante]!, "INSPECT", ids[loupBlanc]!);
    expect(engine.getLastVoyanteResult(ids[voyante]!)).toMatchObject({
      targetId: ids[loupBlanc],
      result: "NON_LOUP",
    });

    // Move on to a later night and inspect the SAME player again -> exposed.
    // (Eliminate an uninvolved villager by day vote just to advance the
    // clock — keep the wolf and Loup Blanc alive so the game continues.)
    engine.resolveNightAndProceed();
    engine.proceedFromMorningToDay();
    engine.endDayDiscussion();
    for (const n of names) {
      if (n !== bystander) engine.castDayVote(ids[n]!, ids[bystander]!);
    }
    engine.tallyDayVoteAndProceed();
    engine.proceedFromDayVoteResultToNight();

    engine.submitNightAction(ids[voyante]!, "INSPECT", ids[loupBlanc]!);
    expect(engine.getLastVoyanteResult(ids[voyante]!)).toMatchObject({
      targetId: ids[loupBlanc],
      result: "LOUP",
    });
  });

  it("a fresh Voyante checking a Loup Blanc that a different Voyante already exposed still starts at NON_LOUP", () => {
    // The counter is per-inspecting-Voyante, not global on the target —
    // confirm two independent Voyantes each get their own first "free" look.
    const names = ["A", "B", "C", "D", "E", "F", "G"];
    const { engine, ids } = bootToNight1(
      names,
      { LOUP_GAROU: 1, LOUP_BLANC: 1, VOYANTE: 2 },
      13,
    );
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const voyantes = names.filter((n) => roles.get(ids[n]!) === "VOYANTE");
    const loupBlanc = names.find((n) => roles.get(ids[n]!) === "LOUP_BLANC")!;
    expect(voyantes).toHaveLength(2);

    engine.submitNightAction(ids[voyantes[0]!]!, "INSPECT", ids[loupBlanc]!);
    engine.submitNightAction(ids[voyantes[1]!]!, "INSPECT", ids[loupBlanc]!);

    expect(engine.getLastVoyanteResult(ids[voyantes[0]!]!)?.result).toBe("NON_LOUP");
    expect(engine.getLastVoyanteResult(ids[voyantes[1]!]!)?.result).toBe("NON_LOUP");
  });
});
