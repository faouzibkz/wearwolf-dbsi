import { describe, expect, it } from "vitest";
import { GameEngine } from "../engine/GameEngine";
import { castDayVotesInOrder, seededRng } from "./helpers";

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

describe("public death reveal (name + role, never the mechanism)", () => {
  it("reveals the dead player's name and role after a night kill, but never a living wolf's role", () => {
    const names = ["A", "B", "C", "D", "E"];
    const { engine, ids } = bootToNight1(names, { LOUP_GAROU: 1 }, 21);
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    const victim = names.find((n) => n !== wolf)!;

    engine.submitNightAction(ids[wolf]!, "KILL_VOTE", ids[victim]!);
    engine.resolveNightAndProceed();

    const publicState = engine.getPublicState();
    expect(publicState.lastDeaths).toHaveLength(1);
    expect(publicState.lastDeaths[0]).toMatchObject({
      playerId: ids[victim],
      nickname: victim,
      roleId: "VILLAGEOIS",
    });

    const deadPlayer = publicState.players.find((p) => p.id === ids[victim]);
    expect(deadPlayer!.isAlive).toBe(false);
    expect(deadPlayer!.revealedRoleId).toBe("VILLAGEOIS");

    const livingWolf = publicState.players.find((p) => p.id === ids[wolf]);
    expect(livingWolf!.revealedRoleId).toBeUndefined();
    expect(JSON.stringify(publicState)).not.toContain("LOUP_GAROU");

    // The mechanism stays hidden: no cause/attacker info anywhere in the public payload.
    const json = JSON.stringify(publicState);
    expect(json).not.toMatch(/ATTACK|SORCIERE|SALVATEUR|PROTECT/);
  });

  it("refreshes lastDeaths each resolution instead of accumulating history", () => {
    const names = ["A", "B", "C", "D", "E"];
    const { engine, ids } = bootToNight1(names, { LOUP_GAROU: 1 }, 21);
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    // Exclude names[0]: bootToNight1 always elects them Chef, and a dead
    // Chef triggers the (unrelated) succession flow tested elsewhere,
    // which would block the phase transitions this test exercises.
    const nightVictim = names.find((n) => n !== wolf && n !== names[0])!;
    const dayVictim = names.find((n) => n !== wolf && n !== nightVictim && n !== names[0])!;

    // Night 1: wolf kills nightVictim.
    engine.submitNightAction(ids[wolf]!, "KILL_VOTE", ids[nightVictim]!);
    engine.resolveNightAndProceed();
    expect(engine.getPublicState().lastDeaths.map((d) => d.playerId)).toEqual([ids[nightVictim]]);

    // Day 2: village votes out dayVictim (not the wolf, so the game continues).
    engine.proceedFromMorningToDay();
    engine.endDayDiscussion();
    const votes: Record<string, string> = {};
    for (const n of names) {
      if (n !== dayVictim && engine.getPublicState().players.find((p) => p.id === ids[n]!)?.isAlive) {
        votes[ids[n]!] = ids[dayVictim]!;
      }
    }
    castDayVotesInOrder(engine, votes);
    expect(engine.getPublicState().lastDeaths.map((d) => d.playerId)).toEqual([ids[dayVictim]]);
    engine.proceedFromDayVoteResultToNight();

    // Night 2: nobody targeted -> nobody dies -> lastDeaths resets to empty,
    // it must NOT still show dayVictim (or nightVictim) from before.
    engine.resolveNightAndProceed();
    expect(engine.getPublicState().lastDeaths).toEqual([]);
    expect(engine.getPublicState().lastMorningAnnouncement).toBe("NO_DEATH");
  });

  it("reveals name and role on a day-vote elimination too", () => {
    const names = ["A", "B", "C", "D", "E"];
    const { engine, ids } = bootToNight1(names, { LOUP_GAROU: 1 }, 33);
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;

    engine.resolveNightAndProceed(); // nobody targeted, nobody dies
    engine.proceedFromMorningToDay();
    engine.endDayDiscussion();
    const votes: Record<string, string> = {};
    for (const n of names) if (n !== wolf) votes[ids[n]!] = ids[wolf]!;
    castDayVotesInOrder(engine, votes);

    const publicState = engine.getPublicState();
    expect(publicState.lastDeaths).toHaveLength(1);
    expect(publicState.lastDeaths[0]).toMatchObject({
      playerId: ids[wolf],
      nickname: wolf,
      roleId: "LOUP_GAROU",
    });
    expect(publicState.players.find((p) => p.id === ids[wolf])!.revealedRoleId).toBe("LOUP_GAROU");
  });
});
