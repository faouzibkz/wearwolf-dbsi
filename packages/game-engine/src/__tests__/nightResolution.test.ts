import type { RoleId } from "@loupgarou/shared";
import { describe, expect, it } from "vitest";
import { GameEngine } from "../engine/GameEngine";
import { seededRng } from "./helpers";

/**
 * These tests build the game directly and drive it past the Chef election
 * (using forceStartChefDebate with zero candidates isn't allowed, so we
 * volunteer nobody and instead call the private-ish flow via the public
 * API: with zero candidates the admin cannot force the debate, so we elect
 * via one volunteer to keep setup minimal).
 */
function bootToNight1(names: string[], roleCounts: Partial<Record<RoleId, number>>) {
  const engine = GameEngine.createGame({ roleCounts }, seededRng(7));
  const ids: Record<string, string> = {};
  for (const n of names) ids[n] = engine.addPlayer(n).id;
  engine.startGame();
  engine.volunteerForChef(ids[names[0]!]!);
  engine.forceStartChefDebate();
  engine.advanceChefSpeaker();
  for (const n of names.slice(1)) engine.castChefVote(ids[n]!, ids[names[0]!]!);
  engine.tallyChefVoteAndProceed();
  engine.endDay1Discussion();
  return { engine, ids };
}

describe("night resolution", () => {
  it("Salvateur protection saves the wolves' target", () => {
    const names = ["A", "B", "C", "D", "E"];
    const { engine, ids } = bootToNight1(names, { LOUP_GAROU: 1, SALVATEUR: 1 });
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    const salvateur = names.find((n) => roles.get(ids[n]!) === "SALVATEUR")!;
    const victim = names.find((n) => n !== wolf && n !== salvateur)!;

    engine.submitNightAction(ids[salvateur]!, "PROTECT", ids[victim]!);
    engine.submitNightAction(ids[wolf]!, "KILL_VOTE", ids[victim]!);
    const result = engine.resolveNightAndProceed();

    expect(result.anyoneDied).toBe(false);
    expect(engine.getPublicState().players.find((p) => p.id === ids[victim]!)!.isAlive).toBe(true);
  });

  it("Sorcière heal saves the target and poison kills an independent target", () => {
    const names = ["A", "B", "C", "D", "E"];
    const { engine, ids } = bootToNight1(names, { LOUP_GAROU: 1, SORCIERE: 1 });
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    const sorciere = names.find((n) => roles.get(ids[n]!) === "SORCIERE")!;
    const attacked = names.find((n) => n !== wolf && n !== sorciere)!;
    const poisoned = names.find((n) => n !== wolf && n !== sorciere && n !== attacked)!;

    engine.submitNightAction(ids[wolf]!, "KILL_VOTE", ids[attacked]!);
    engine.submitNightAction(ids[sorciere]!, "HEAL");
    engine.submitNightAction(ids[sorciere]!, "POISON", ids[poisoned]!);
    const result = engine.resolveNightAndProceed();

    expect(result.anyoneDied).toBe(true);
    const publicPlayers = engine.getPublicState().players;
    expect(publicPlayers.find((p) => p.id === ids[attacked]!)!.isAlive).toBe(true);
    expect(publicPlayers.find((p) => p.id === ids[poisoned]!)!.isAlive).toBe(false);
  });

  it("only reveals DEATH/NO_DEATH to the public state, never who or how", () => {
    const names = ["A", "B", "C", "D"];
    const { engine, ids } = bootToNight1(names, { LOUP_GAROU: 1 });
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    const victim = names.find((n) => n !== wolf)!;
    engine.submitNightAction(ids[wolf]!, "KILL_VOTE", ids[victim]!);
    engine.resolveNightAndProceed();

    const json = JSON.stringify(engine.getPublicState());
    expect(json).not.toContain("LOUP_GAROU");
    expect(engine.getPublicState().lastMorningAnnouncement).toBe("DEATH");
  });
});
