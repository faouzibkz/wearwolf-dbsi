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

// This is the read model apps/server's account/history layer (Phase 1 of
// the accounts/stats spec) persists at GAME_ENDED — it must stay flat and
// role-agnostic (team comes from ROLE_METADATA, not a per-role switch).
describe("getFinalPlayerSummaries", () => {
  it("reports team (via ROLE_METADATA, not a hardcoded switch), survival, and null deathCause/deathMoment for a survivor", () => {
    const names = ["A", "B", "C", "D", "E"];
    const { engine, ids } = bootToNight1(names, { LOUP_GAROU: 1 }, 21);
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    const survivor = names.find((n) => n !== wolf)!;

    const summaries = engine.getFinalPlayerSummaries();
    const wolfSummary = summaries.find((s) => s.playerId === ids[wolf]!)!;
    const survivorSummary = summaries.find((s) => s.playerId === ids[survivor]!)!;

    expect(wolfSummary.team).toBe("LOUPS");
    expect(survivorSummary.team).toBe("VILLAGE");
    expect(survivorSummary.isAlive).toBe(true);
    expect(survivorSummary.deathCause).toBeNull();
    expect(survivorSummary.deathMoment).toBeNull();
  });

  it("records a 'Nuit N' deathMoment for a night kill", () => {
    const names = ["A", "B", "C", "D", "E"];
    const { engine, ids } = bootToNight1(names, { LOUP_GAROU: 1 }, 21);
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    const victim = names.find((n) => n !== wolf)!;

    engine.submitNightAction(ids[wolf]!, "KILL_VOTE", ids[victim]!);
    engine.resolveNightAndProceed();

    const summary = engine.getFinalPlayerSummaries().find((s) => s.playerId === ids[victim]!)!;
    expect(summary.isAlive).toBe(false);
    expect(summary.deathCause).toBe("LOUP_GAROU_ATTACK");
    expect(summary.deathMoment).toBe("Nuit 1");
  });

  it("records a 'Jour N' deathMoment for a day-vote elimination", () => {
    const names = ["A", "B", "C", "D", "E"];
    const { engine, ids } = bootToNight1(names, { LOUP_GAROU: 1 }, 33);
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;

    engine.resolveNightAndProceed(); // nobody targeted, nobody dies
    engine.proceedFromMorningToDay(); // -> day 2
    engine.endDayDiscussion();
    const votes: Record<string, string> = {};
    for (const n of names) if (n !== wolf) votes[ids[n]!] = ids[wolf]!;
    castDayVotesInOrder(engine, votes);

    const summary = engine.getFinalPlayerSummaries().find((s) => s.playerId === ids[wolf]!)!;
    expect(summary.isAlive).toBe(false);
    expect(summary.deathCause).toBe("VOTE_ELIMINATION");
    expect(summary.deathMoment).toBe("Jour 2");
  });
});
