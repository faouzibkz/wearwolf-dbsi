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

describe("wolves know their teammates from role assignment (feature 1)", () => {
  it("returns fellow wolves (LOUP_GAROU + LOUP_BLANC) by id + nickname, excluding self", () => {
    const names = ["A", "B", "C", "D", "E"];
    const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1, LOUP_BLANC: 1 } }, seededRng(4));
    const ids: Record<string, string> = {};
    for (const n of names) ids[n] = engine.addPlayer(n).id;
    engine.startGame();

    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    const loupBlanc = names.find((n) => roles.get(ids[n]!) === "LOUP_BLANC")!;

    expect(engine.getWolfTeammates(ids[wolf]!)).toEqual([{ id: ids[loupBlanc]!, nickname: loupBlanc }]);
    expect(engine.getWolfTeammates(ids[loupBlanc]!)).toEqual([{ id: ids[wolf]!, nickname: wolf }]);
  });

  it("is empty for a non-wolf", () => {
    const names = ["A", "B", "C", "D", "E"];
    const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1, LOUP_BLANC: 1 } }, seededRng(4));
    const ids: Record<string, string> = {};
    for (const n of names) ids[n] = engine.addPlayer(n).id;
    engine.startGame();

    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const villager = names.find((n) => roles.get(ids[n]!) === "VILLAGEOIS")!;
    expect(engine.getWolfTeammates(ids[villager]!)).toEqual([]);
  });

  it("is empty when there's only a single wolf (no teammate to know)", () => {
    const names = ["A", "B", "C", "D", "E"];
    const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1 } }, seededRng(4));
    const ids: Record<string, string> = {};
    for (const n of names) ids[n] = engine.addPlayer(n).id;
    engine.startGame();

    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    expect(engine.getWolfTeammates(ids[wolf]!)).toEqual([]);
  });
});

describe("wolves can target themselves or a fellow wolf at night (feature 2, misdirection play)", () => {
  it("includes the acting wolf's own id and a fellow wolf's id in the night prompt's eligible targets", () => {
    const names = ["A", "B", "C", "D", "E"];
    const { engine, ids } = bootToNight1(names, { LOUP_GAROU: 1, LOUP_BLANC: 1 }, 4);
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    const loupBlanc = names.find((n) => roles.get(ids[n]!) === "LOUP_BLANC")!;

    const prompts = engine.getNightPrompts();
    const wolfPrompt = prompts.find((p) => p.player.id === ids[wolf])!;
    expect(wolfPrompt.request.eligibleTargetIds).toContain(ids[wolf]); // himself
    expect(wolfPrompt.request.eligibleTargetIds).toContain(ids[loupBlanc]); // teammate
  });

  it("lets a lone wolf vote to kill himself (pure misdirection, no other wolf to back him up)", () => {
    const names = ["A", "B", "C", "D", "E"];
    const { engine, ids } = bootToNight1(names, { LOUP_GAROU: 1 }, 4);
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;

    engine.submitNightAction(ids[wolf]!, "KILL_VOTE", ids[wolf]!); // targets himself
    const result = engine.resolveNightAndProceed();

    expect(result.anyoneDied).toBe(true);
    expect(engine.getPublicState().players.find((p) => p.id === ids[wolf])!.isAlive).toBe(false);
  });

  it("lets one wolf's vote kill a fellow wolf", () => {
    const names = ["A", "B", "C", "D", "E"];
    const { engine, ids } = bootToNight1(names, { LOUP_GAROU: 1, LOUP_BLANC: 1 }, 4);
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    const loupBlanc = names.find((n) => roles.get(ids[n]!) === "LOUP_BLANC")!;

    // Both wolves agree to sacrifice the Loup Blanc — majority vote lands
    // on him even though it's his own side voting him out.
    engine.submitNightAction(ids[wolf]!, "KILL_VOTE", ids[loupBlanc]!);
    engine.submitNightAction(ids[loupBlanc]!, "KILL_VOTE", ids[loupBlanc]!);
    const result = engine.resolveNightAndProceed();

    expect(result.anyoneDied).toBe(true);
    expect(engine.getPublicState().players.find((p) => p.id === ids[loupBlanc])!.isAlive).toBe(false);
    // The surviving wolf's role must not have leaked in the public reveal.
    expect(engine.getPublicState().players.find((p) => p.id === ids[wolf])!.revealedRoleId).toBeUndefined();
  });
});

describe("getWolfKillVotes (feature 6: live wolf target preview)", () => {
  it("is empty before any wolf has voted", () => {
    const names = ["A", "B", "C", "D", "E"];
    const { engine } = bootToNight1(names, { LOUP_GAROU: 1, LOUP_BLANC: 1 }, 4);
    expect(engine.getWolfKillVotes()).toEqual({});
  });

  it("reflects each wolf's confirmed vote as soon as it's submitted, keyed by voter", () => {
    const names = ["A", "B", "C", "D", "E"];
    const { engine, ids } = bootToNight1(names, { LOUP_GAROU: 1, LOUP_BLANC: 1 }, 4);
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    const loupBlanc = names.find((n) => roles.get(ids[n]!) === "LOUP_BLANC")!;
    const villager = names.find((n) => n !== wolf && n !== loupBlanc)!;

    engine.submitNightAction(ids[wolf]!, "KILL_VOTE", ids[villager]!);
    expect(engine.getWolfKillVotes()).toEqual({ [ids[wolf]!]: ids[villager]! });

    engine.submitNightAction(ids[loupBlanc]!, "KILL_VOTE", ids[villager]!);
    expect(engine.getWolfKillVotes()).toEqual({
      [ids[wolf]!]: ids[villager]!,
      [ids[loupBlanc]!]: ids[villager]!,
    });
  });

  it("returns a defensive copy — mutating the result never touches engine state", () => {
    const names = ["A", "B", "C", "D", "E"];
    const { engine, ids } = bootToNight1(names, { LOUP_GAROU: 1, LOUP_BLANC: 1 }, 4);
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    const villager = names.find((n) => n !== wolf)!;
    engine.submitNightAction(ids[wolf]!, "KILL_VOTE", ids[villager]!);

    const votes = engine.getWolfKillVotes();
    votes["tampered"] = "should-not-stick";
    expect(engine.getWolfKillVotes()).not.toHaveProperty("tampered");
  });
});
