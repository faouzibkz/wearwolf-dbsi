import { describe, expect, it } from "vitest";
import { GameEngine } from "../engine/GameEngine";
import { castDayVotesInOrder, seededRng } from "./helpers";

/**
 * Cahier de charge #2 §17.3 — reuses `isSpectator` (already part of
 * InternalPlayer/PlayerPublic, but never written anywhere before this)
 * to mean "dead, in Afterlife/spectator mode from now on". See
 * DeathQueue.processDeaths and GameEngine.getAfterlifeMemberIds.
 */
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

describe("Afterlife eligibility (isSpectator reused for dead players)", () => {
  it("everyone starts alive, nobody is a spectator", () => {
    const names = ["A", "B", "C", "D", "E"];
    const { engine } = bootToNight1(names, { LOUP_GAROU: 1 }, 21);
    expect(engine.getPublicState().players.every((p) => !p.isSpectator)).toBe(true);
    expect(engine.getAfterlifeMemberIds()).toEqual([]);
  });

  it("a night-kill victim becomes a spectator the instant the night resolves", () => {
    const names = ["A", "B", "C", "D", "E"];
    const { engine, ids } = bootToNight1(names, { LOUP_GAROU: 1 }, 21);
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    const victim = names.find((n) => n !== wolf)!;

    engine.submitNightAction(ids[wolf]!, "KILL_VOTE", ids[victim]!);
    engine.resolveNightAndProceed();

    const victimPublic = engine.getPublicState().players.find((p) => p.id === ids[victim]!)!;
    expect(victimPublic.isAlive).toBe(false);
    expect(victimPublic.isSpectator).toBe(true);
    expect(engine.getAfterlifeMemberIds()).toEqual([ids[victim]!]);

    // Everyone else, including the killer, is still not a spectator.
    for (const n of names) {
      if (n === victim) continue;
      expect(engine.getPublicState().players.find((p) => p.id === ids[n]!)!.isSpectator).toBe(false);
    }
  });

  it("a day-vote elimination also grants Afterlife membership", () => {
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

    expect(engine.getPublicState().players.find((p) => p.id === ids[wolf]!)!.isSpectator).toBe(true);
    expect(engine.getAfterlifeMemberIds()).toEqual([ids[wolf]!]);
  });

  it("membership accumulates across multiple deaths and never shrinks back", () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    const { engine, ids } = bootToNight1(names, { LOUP_GAROU: 1, CHASSEUR: 1 }, 41);
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    // Exclude the elected Chef (always names[0]) from being targeted, same
    // reasoning as deathReveal.test.ts: a dead Chef opens an unrelated
    // succession flow this test isn't about.
    const nightVictim = names.find((n) => n !== wolf && n !== names[0])!;

    engine.submitNightAction(ids[wolf]!, "KILL_VOTE", ids[nightVictim]!);
    engine.resolveNightAndProceed();
    expect(engine.getAfterlifeMemberIds()).toEqual([ids[nightVictim]!]);

    engine.proceedFromMorningToDay();
    engine.endDayDiscussion();
    const dayVictim = names.find((n) => n !== wolf && n !== nightVictim && n !== names[0])!;
    const votes: Record<string, string> = {};
    for (const n of names) {
      if (n === dayVictim) continue;
      if (engine.getPublicState().players.find((p) => p.id === ids[n]!)?.isAlive) {
        votes[ids[n]!] = ids[dayVictim]!;
      }
    }
    castDayVotesInOrder(engine, votes);

    // Both the night victim AND the day victim are now members — the set
    // only ever grows, it's never recomputed as "just tonight's/today's
    // death" the way lastDeathPlayerIds is (see deathReveal.test.ts).
    expect(new Set(engine.getAfterlifeMemberIds())).toEqual(
      new Set([ids[nightVictim]!, ids[dayVictim]!]),
    );
  });

  it("a still-alive player is never a spectator, no matter how many others have died", () => {
    const names = ["A", "B", "C", "D", "E"];
    const { engine, ids } = bootToNight1(names, { LOUP_GAROU: 1 }, 21);
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    const victim = names.find((n) => n !== wolf)!;

    engine.submitNightAction(ids[wolf]!, "KILL_VOTE", ids[victim]!);
    engine.resolveNightAndProceed();

    expect(engine.getAfterlifeMemberIds()).not.toContain(ids[wolf]!);
    expect(engine.getPublicState().players.find((p) => p.id === ids[wolf]!)!.isSpectator).toBe(false);
  });
});
