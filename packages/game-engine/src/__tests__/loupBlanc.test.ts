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

describe("Loup Blanc plays as a plain Loup-Garou (pack kill vote only, no special power)", () => {
  it("can vote to kill a villager alongside a living Loup-Garou", () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    const { engine, ids } = bootToNight1(names, { LOUP_GAROU: 1, LOUP_BLANC: 1 }, 4);
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const loupBlanc = names.find((n) => roles.get(ids[n]!) === "LOUP_BLANC")!;
    const villager = names.find((n) => roles.get(ids[n]!) === "VILLAGEOIS")!;

    engine.submitNightAction(ids[loupBlanc]!, "KILL_VOTE", ids[villager]!);
    const result = engine.resolveNightAndProceed();

    expect(result.anyoneDied).toBe(true);
    expect(engine.getPublicState().players.find((p) => p.id === ids[villager])!.isAlive).toBe(false);
  });

  it("BUG FIX: can still kill a villager once he is the only wolf left alive (regular Loup-Garou already dead)", () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    const { engine, ids } = bootToNight1(names, { LOUP_GAROU: 1, LOUP_BLANC: 1 }, 4);
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    const loupBlanc = names.find((n) => roles.get(ids[n]!) === "LOUP_BLANC")!;
    const villager = names.find((n) => roles.get(ids[n]!) === "VILLAGEOIS")!;

    // Night 1: nobody dies, but eliminate the regular Loup-Garou by day
    // vote so the Loup Blanc becomes the last wolf standing.
    engine.resolveNightAndProceed();
    engine.proceedFromMorningToDay();
    engine.endDayDiscussion();
    for (const n of names) if (n !== wolf) engine.castDayVote(ids[n]!, ids[wolf]!);
    const outcome = engine.tallyDayVoteAndProceed();
    expect(outcome.eliminatedId).toBe(ids[wolf]);
    expect(engine.getPhase()).toBe("DAY_VOTE_RESULT"); // brief announcement pause first
    engine.proceedFromDayVoteResultToNight();
    expect(engine.getPhase()).toBe("NIGHT"); // game continues, Loup Blanc still alive

    const prompts = engine.getNightPrompts();
    const myPrompt = prompts.find((p) => p.player.id === ids[loupBlanc]);
    expect(myPrompt).toBeDefined();
    expect(myPrompt!.request.actionType).toBe("KILL_VOTE");
    expect(myPrompt!.request.eligibleTargetIds).toContain(ids[villager]);

    engine.submitNightAction(ids[loupBlanc]!, "KILL_VOTE", ids[villager]!);
    const result = engine.resolveNightAndProceed();

    expect(result.anyoneDied).toBe(true);
    expect(engine.getPublicState().players.find((p) => p.id === ids[villager])!.isAlive).toBe(false);
  });

  it("cannot target a fellow wolf (no devour power) or himself", () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    const { engine, ids } = bootToNight1(names, { LOUP_GAROU: 1, LOUP_BLANC: 1 }, 4);
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    const loupBlanc = names.find((n) => roles.get(ids[n]!) === "LOUP_BLANC")!;

    const prompts = engine.getNightPrompts();
    const myPrompt = prompts.find((p) => p.player.id === ids[loupBlanc]);
    expect(myPrompt!.request.eligibleTargetIds).not.toContain(ids[wolf]);
    expect(myPrompt!.request.eligibleTargetIds).not.toContain(ids[loupBlanc]);

    // The regular Loup-Garou's own prompt can't target the Loup Blanc either.
    const wolfPrompt = prompts.find((p) => p.player.id === ids[wolf]);
    expect(wolfPrompt!.request.eligibleTargetIds).not.toContain(ids[loupBlanc]);
  });
});
