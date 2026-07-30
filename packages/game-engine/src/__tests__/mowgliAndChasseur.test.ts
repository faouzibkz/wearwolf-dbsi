import { describe, expect, it } from "vitest";
import { GameEngine } from "../engine/GameEngine";
import { seededRng } from "./helpers";

describe("Mowgli transformation", () => {
  it("transforms into a Loup-garou when the chosen father dies, and never leaks who Mowgli is", () => {
    const names = ["A", "B", "C", "D", "E"];
    const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1, MOWGLI: 1 } }, seededRng(3));
    const ids: Record<string, string> = {};
    for (const n of names) ids[n] = engine.addPlayer(n).id;
    engine.startGame();
    engine.volunteerForChef(ids.A!);
    engine.forceStartChefDebate();
    engine.advanceChefSpeaker();
    for (const n of ["B", "C", "D", "E"]) engine.castChefVote(ids[n]!, ids.A!);
    engine.tallyChefVoteAndProceed();
    engine.proceedFromChefRevealToDiscussion();
    engine.endDay1Discussion();

    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    const mowgli = names.find((n) => roles.get(ids[n]!) === "MOWGLI")!;
    const others = names.filter((n) => n !== wolf && n !== mowgli);
    const father = others[0]!;

    // Night 1: Mowgli picks a father; wolves kill that same father.
    engine.submitNightAction(ids[mowgli]!, "CHOOSE_FATHER", ids[father]!);
    engine.submitNightAction(ids[wolf]!, "KILL_VOTE", ids[father]!);
    const result = engine.resolveNightAndProceed();

    expect(result.mowgliTransformed).toBe(true);
    const adminRoles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    expect(adminRoles.get(ids[mowgli]!)).toBe("LOUP_GAROU");

    // Public state never contains role identifiers.
    expect(JSON.stringify(engine.getPublicState())).not.toContain("LOUP_GAROU");
  });
});

describe("Chasseur death trigger", () => {
  it("blocks phase progression until the Chasseur's shot is resolved, then applies it", () => {
    const names = ["A", "B", "C", "D", "E"];
    const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1, CHASSEUR: 1 } }, seededRng(11));
    const ids: Record<string, string> = {};
    for (const n of names) ids[n] = engine.addPlayer(n).id;
    engine.startGame();
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    const chasseur = names.find((n) => roles.get(ids[n]!) === "CHASSEUR")!;
    const others = names.filter((n) => n !== wolf && n !== chasseur);
    const chief = others[0]!;
    const bystander = others[1]!;

    // Elect someone who is neither the Chasseur nor the shot's target as
    // Chef: this test is about the Chasseur's own death-triggered shot
    // blocking, and must stay isolated from the separate Chef succession
    // flow, which would ALSO block progression if the elected Chef died.
    engine.volunteerForChef(ids[chief]!);
    engine.forceStartChefDebate();
    engine.advanceChefSpeaker();
    for (const n of names) if (n !== chief) engine.castChefVote(ids[n]!, ids[chief]!);
    engine.tallyChefVoteAndProceed();
    engine.proceedFromChefRevealToDiscussion();
    engine.endDay1Discussion();

    engine.submitNightAction(ids[wolf]!, "KILL_VOTE", ids[chasseur]!);
    const result = engine.resolveNightAndProceed();

    expect(result.blocked).toBe(true);
    expect(engine.getPhase()).toBe("NIGHT"); // did not advance to MORNING yet
    expect(engine.getPendingChasseurShooterIds()).toEqual([ids[chasseur]]);

    engine.submitChasseurShot(ids[chasseur]!, ids[bystander]!);
    expect(engine.getPhase()).toBe("MORNING");
    expect(engine.getPublicState().players.find((p) => p.id === ids[bystander]!)!.isAlive).toBe(false);
  });
});
