import { describe, expect, it } from "vitest";
import { GameEngine } from "../engine/GameEngine";

function bootToChefCandidacy(names: string[], roleCounts: Record<string, number>) {
  const engine = GameEngine.createGame({ roleCounts: roleCounts as any });
  const ids: Record<string, string> = {};
  for (const n of names) ids[n] = engine.addPlayer(n).id;
  engine.startGame(); // -> CHEF_CANDIDACY, a valid non-LOBBY/non-ENDED phase
  return { engine, ids };
}

function electChef(engine: GameEngine, ids: Record<string, string>, names: string[], chiefName: string) {
  engine.volunteerForChef(ids[chiefName]!);
  engine.forceStartChefDebate();
  engine.advanceChefSpeaker();
  for (const n of names) if (n !== chiefName) engine.castChefVote(ids[n]!, ids[chiefName]!);
  engine.tallyChefVoteAndProceed();
  engine.proceedFromChefRevealToDiscussion();
}

describe("GameEngine.adminKillPlayer", () => {
  it("kills an alive player outright: isAlive false, isSpectator true, recorded death cause", () => {
    const names = ["A", "B", "C", "D"];
    const { engine, ids } = bootToChefCandidacy(names, { VILLAGEOIS: 4 });

    engine.adminKillPlayer(ids.A!);

    const target = engine.getPlayers().find((p) => p.id === ids.A!)!;
    expect(target.isAlive).toBe(false);
    expect(target.isSpectator).toBe(true);
    expect(target.deathCause).toBe("ADMIN_KILL");
  });

  it("throws during LOBBY — there's no one to kill before the game even starts", () => {
    const engine = GameEngine.createGame({ roleCounts: { VILLAGEOIS: 4 } as any });
    const a = engine.addPlayer("A");
    engine.addPlayer("B");
    engine.addPlayer("C");
    engine.addPlayer("D");
    expect(() => engine.adminKillPlayer(a.id)).toThrow();
  });

  it("throws once the game has already ended", () => {
    const names = ["A", "B", "C", "D"];
    const { engine, ids } = bootToChefCandidacy(names, { VILLAGEOIS: 4 });
    engine.endGame();
    expect(() => engine.adminKillPlayer(ids.A!)).toThrow();
  });

  it("throws if the target is already dead", () => {
    const names = ["A", "B", "C", "D"];
    const { engine, ids } = bootToChefCandidacy(names, { VILLAGEOIS: 4 });
    engine.adminKillPlayer(ids.A!);
    expect(() => engine.adminKillPlayer(ids.A!)).toThrow();
  });

  it("triggers the Chasseur's pending revenge shot, exactly like any other kill", () => {
    const names = ["A", "B", "C", "D", "E"];
    const { engine, ids } = bootToChefCandidacy(names, { LOUP_GAROU: 1, CHASSEUR: 1 });
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const chasseur = names.find((n) => roles.get(ids[n]!) === "CHASSEUR")!;

    engine.adminKillPlayer(ids[chasseur]!);

    expect(engine.getPendingChasseurShooterIds()).toEqual([ids[chasseur]]);
    // Victory isn't checked yet — a pending blocker holds everything.
    expect(engine.getPhase()).not.toBe("ENDED");

    const bystander = names.find((n) => n !== chasseur && roles.get(ids[n]!) !== "LOUP_GAROU")!;
    engine.submitChasseurShot(ids[chasseur]!, ids[bystander]!);
    expect(engine.getPlayers().find((p) => p.id === ids[bystander]!)!.isAlive).toBe(false);
  });

  it("triggers Chef succession when the elected Chef is killed", () => {
    const names = ["A", "B", "C", "D", "E"];
    const { engine, ids } = bootToChefCandidacy(names, { VILLAGEOIS: 5 });
    electChef(engine, ids, names, "A");
    expect(engine.getPublicState().chefId).toBe(ids.A);

    engine.adminKillPlayer(ids.A!);

    expect(engine.getPendingChefSuccessionDeadChefId()).toBe(ids.A);
    engine.chooseChefSuccessor(ids.A!, ids.B!);
    expect(engine.getPublicState().chefId).toBe(ids.B);
  });

  it("ends the game immediately if the kill completes a village victory", () => {
    const names = ["A", "B", "C", "D"];
    const { engine, ids } = bootToChefCandidacy(names, { LOUP_GAROU: 1 });
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;

    engine.adminKillPlayer(ids[wolf]!);

    expect(engine.getPhase()).toBe("ENDED");
    expect(engine.getPublicState().winner).toBe("VILLAGE");
  });
});
