import { describe, expect, it } from "vitest";
import { GameEngine } from "../engine/GameEngine";
import { seededRng } from "./helpers";

function bootToNight1(names: string[], roleCounts: Record<string, number>, seed: number) {
  const engine = GameEngine.createGame(
    { roleCounts: roleCounts as any, loupBlancRule: { mode: "EVERY_NIGHT" } },
    seededRng(seed),
  );
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

describe("Loup Blanc joins the pack's regular kill vote", () => {
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
    expect(engine.getPhase()).toBe("NIGHT"); // game continues, Loup Blanc still alive

    // Before the fix, the Loup Blanc got NO night prompt at all here (his
    // only action was DEVOUR_WOLF, which requires a living fellow wolf) —
    // he was completely unable to kill anyone.
    const prompts = engine.getNightPrompts();
    const myPrompt = prompts.find((p) => p.player.id === ids[loupBlanc]);
    expect(myPrompt).toBeDefined();
    expect(myPrompt!.request.actionType).toBe("LOUP_BLANC_ACT");
    expect((myPrompt!.request.context as any).killEligible).toContain(ids[villager]);

    engine.submitNightAction(ids[loupBlanc]!, "KILL_VOTE", ids[villager]!);
    const result = engine.resolveNightAndProceed();

    expect(result.anyoneDied).toBe(true);
    expect(engine.getPublicState().players.find((p) => p.id === ids[villager])!.isAlive).toBe(false);
  });

  it("can still secretly devour a fellow Loup-Garou on an active devour night", () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    const { engine, ids } = bootToNight1(names, { LOUP_GAROU: 1, LOUP_BLANC: 1 }, 4);
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    const loupBlanc = names.find((n) => roles.get(ids[n]!) === "LOUP_BLANC")!;

    engine.submitNightAction(ids[loupBlanc]!, "DEVOUR_WOLF", ids[wolf]!);
    const result = engine.resolveNightAndProceed();

    expect(result.anyoneDied).toBe(true);
    expect(engine.getPublicState().players.find((p) => p.id === ids[wolf])!.isAlive).toBe(false);
  });
});
