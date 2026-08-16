import { describe, expect, it } from "vitest";
import { GameEngine } from "../engine/GameEngine";
import { castDayVotesInOrder, seededRng } from "./helpers";

function bootToNight1(seed: number, roleCounts: Record<string, number>, names: string[]) {
  const engine = GameEngine.createGame({ roleCounts: roleCounts as any }, seededRng(seed));
  const ids: Record<string, string> = {};
  for (const n of names) ids[n] = engine.addPlayer(n).id;
  engine.startGame();
  const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
  engine.volunteerForChef(ids[names[0]!]!);
  engine.forceStartChefDebate();
  engine.advanceChefSpeaker();
  for (const n of names.slice(1)) engine.castChefVote(ids[n]!, ids[names[0]!]!);
  engine.tallyChefVoteAndProceed();
  engine.proceedFromChefRevealToDiscussion();
  engine.endDay1Discussion(); // -> NIGHT 1
  return { engine, ids, roles };
}

describe("Prêtre", () => {
  it("is offered from night 1 — no waiting period unlike the Loup Vert's guess", () => {
    const names = ["Chef", "Pretre", "V1", "V2"];
    const { engine, ids, roles } = bootToNight1(1, { PRETRE: 1 }, names);
    const pretreId = ids[names.find((n) => roles.get(ids[n]!) === "PRETRE")!]!;
    const prompt = engine.getNightPrompts().find((p) => p.player.id === pretreId);
    expect(prompt).toBeTruthy();
    expect(prompt!.request.actionType).toBe("PRETRE_SHOOT");
    // Eligible targets include himself — the one deliberate difference from alien.ts.
    expect(prompt!.request.eligibleTargetIds).toContain(pretreId);
  });

  it("a shot that lands on a wolf kills the wolf, the Prêtre survives, and the death reveals normally (role public, cause hidden)", () => {
    const names = ["Chef", "Pretre", "LoupGarou", "V1", "V2"];
    const { engine, ids, roles } = bootToNight1(3, { PRETRE: 1, LOUP_GAROU: 1 }, names);
    const pretreId = names.find((n) => roles.get(ids[n]!) === "PRETRE")!;
    const wolfId = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;

    engine.submitNightAction(ids[pretreId]!, "PRETRE_SHOOT", ids[wolfId]!);

    expect(engine.getPublicState().players.find((p) => p.id === ids[wolfId]!)!.isAlive).toBe(false);
    expect(engine.getPublicState().players.find((p) => p.id === ids[pretreId]!)!.isAlive).toBe(true);

    const result = engine.resolveNightAndProceed();
    expect(result.anyoneDied).toBe(true);
    // Public lastDeaths carries name + role but no "cause" — no way to tell the Prêtre did it.
    const death = engine.getPublicState().lastDeaths.find((d) => d.playerId === ids[wolfId]!);
    expect(death).toBeTruthy();
    expect(JSON.stringify(death)).not.toMatch(/PRETRE/i);
  });

  it("a shot on a non-wolf kills ONLY the Prêtre — the target is left completely untouched", () => {
    const names = ["Chef", "Pretre", "V1", "V2"];
    const { engine, ids, roles } = bootToNight1(4, { PRETRE: 1 }, names);
    const pretreId = names.find((n) => roles.get(ids[n]!) === "PRETRE")!;
    const target = names.find((n) => n !== pretreId)!;

    engine.submitNightAction(ids[pretreId]!, "PRETRE_SHOOT", ids[target]!);

    expect(engine.getPublicState().players.find((p) => p.id === ids[pretreId]!)!.isAlive).toBe(false);
    expect(engine.getPublicState().players.find((p) => p.id === ids[target]!)!.isAlive).toBe(true);
  });

  it("can target himself — a self-shot is never a wolf, so it always kills only him", () => {
    const names = ["Chef", "Pretre", "V1", "V2"];
    const { engine, ids, roles } = bootToNight1(5, { PRETRE: 1 }, names);
    const pretreId = names.find((n) => roles.get(ids[n]!) === "PRETRE")!;

    engine.submitNightAction(ids[pretreId]!, "PRETRE_SHOOT", ids[pretreId]!);

    expect(engine.getPublicState().players.find((p) => p.id === ids[pretreId]!)!.isAlive).toBe(false);
    // Everyone else untouched.
    for (const n of names) {
      if (n === pretreId) continue;
      expect(engine.getPublicState().players.find((p) => p.id === ids[n]!)!.isAlive).toBe(true);
    }
  });

  it("is one-shot per game: even a successful shot (Prêtre survives) never offers PRETRE_SHOOT again", () => {
    // Two wolves in the roster — killing one via the Prêtre's shot must not
    // itself end the game (no-wolves-left VILLAGE victory), which would
    // otherwise short-circuit the rest of this test about later nights.
    const names = ["Chef", "Pretre", "LoupGarou", "LoupGarou2", "V1", "V2"];
    const { engine, ids, roles } = bootToNight1(9, { PRETRE: 1, LOUP_GAROU: 2 }, names);
    const pretreId = names.find((n) => roles.get(ids[n]!) === "PRETRE")!;
    const wolves = names.filter((n) => roles.get(ids[n]!) === "LOUP_GAROU");
    // Deliberately not the elected Chef ("Chef" nickname) — killing the Chef
    // triggers a pending succession that blocks resolveNightAndProceed()
    // from reaching MORNING, an unrelated mechanic this test isn't about.
    const wolfId = wolves.find((w) => w !== "Chef")!;
    const filler = names.find((n) => n !== pretreId && !wolves.includes(n) && n !== "Chef")!;

    engine.submitNightAction(ids[pretreId]!, "PRETRE_SHOOT", ids[wolfId]!); // hits one wolf -> Prêtre survives, other wolf remains
    expect(engine.getPublicState().players.find((p) => p.id === ids[pretreId]!)!.isAlive).toBe(true);
    expect(engine.getNightPrompts().some((p) => p.player.id === ids[pretreId]!)).toBe(false);

    engine.resolveNightAndProceed(); // -> MORNING
    engine.proceedFromMorningToDay();
    engine.endDayDiscussion();
    const alive = engine.getPublicState().players.filter((p) => p.isAlive).map((p) => p.id);
    const votes: Record<string, string> = {};
    for (const id of alive) votes[id] = ids[filler]!;
    castDayVotesInOrder(engine, votes);
    engine.proceedFromDayVoteResultToNight(); // -> NIGHT 2

    // Still alive, still Prêtre, but the power is permanently spent.
    expect(engine.getPublicState().players.find((p) => p.id === ids[pretreId]!)!.isAlive).toBe(true);
    expect(engine.getNightPrompts().some((p) => p.player.id === ids[pretreId]!)).toBe(false);
  });

  it("stays available on a later night if he skips — SKIP never spends the power", () => {
    // A lone wolf, kept alive and untouched throughout, purely so the game
    // doesn't instantly declare a no-wolves-left VILLAGE victory the moment
    // night 1 resolves (see VictoryConditions) — irrelevant to this test.
    const names = ["Chef", "Pretre", "LoupGarou", "V1", "V2", "V3"];
    const { engine, ids, roles } = bootToNight1(6, { PRETRE: 1, LOUP_GAROU: 1 }, names);
    const pretreId = names.find((n) => roles.get(ids[n]!) === "PRETRE")!;
    const wolfId = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;

    engine.submitNightAction(ids[pretreId]!, "SKIP");
    expect(engine.getPublicState().players.find((p) => p.id === ids[pretreId]!)!.isAlive).toBe(true);

    engine.resolveNightAndProceed(); // -> MORNING
    engine.proceedFromMorningToDay(); // -> DAY_DISCUSSION
    engine.endDayDiscussion(); // -> DAY_VOTE

    const alive = engine.getPublicState().players.filter((p) => p.isAlive).map((p) => p.id);
    const filler = names.find((n) => n !== pretreId && n !== "Chef" && n !== wolfId)!;
    const votes: Record<string, string> = {};
    for (const id of alive) votes[id] = ids[filler]!;
    castDayVotesInOrder(engine, votes);
    engine.proceedFromDayVoteResultToNight(); // -> NIGHT 2

    const prompt = engine.getNightPrompts().find((p) => p.player.id === ids[pretreId]!);
    expect(prompt).toBeTruthy();
    expect(prompt!.request.actionType).toBe("PRETRE_SHOOT");
  });

  it("kills a wolf who has already voted with the pack the same night just like any other kill (no special-casing)", () => {
    // Not asserting anything about the wolf's already-cast vote here — just
    // confirming the Prêtre's kill goes through the same universal
    // processDeaths path regardless of what else happened this night.
    const names = ["Chef", "Pretre", "LoupGarou", "V1", "V2"];
    const { engine, ids, roles } = bootToNight1(8, { PRETRE: 1, LOUP_GAROU: 1 }, names);
    const pretreId = names.find((n) => roles.get(ids[n]!) === "PRETRE")!;
    const wolfId = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    const filler = names.find((n) => n !== pretreId && n !== wolfId && n !== "Chef")!;

    engine.submitNightAction(ids[wolfId]!, "KILL_VOTE", ids[filler]!);
    engine.submitNightAction(ids[pretreId]!, "PRETRE_SHOOT", ids[wolfId]!);

    expect(engine.getPublicState().players.find((p) => p.id === ids[wolfId]!)!.isAlive).toBe(false);
  });

  describe("stealable by the Loup Vert, with no special-casing", () => {
    function bootToNight2WithPretre(seed: number) {
      const names = ["LoupVert", "Pretre", "Chef", "V2", "V3"];
      const engine = GameEngine.createGame({ roleCounts: { LOUP_VERT: 1, PRETRE: 1 } }, seededRng(seed));
      const ids: Record<string, string> = {};
      for (const n of names) ids[n] = engine.addPlayer(n).id;
      engine.startGame();
      const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
      const loupVertId = names.find((n) => roles.get(ids[n]!) === "LOUP_VERT")!;
      const pretreId = names.find((n) => roles.get(ids[n]!) === "PRETRE")!;
      const chefName = names.find((n) => n !== loupVertId && n !== pretreId)!;

      engine.volunteerForChef(ids[chefName]!);
      engine.forceStartChefDebate();
      engine.advanceChefSpeaker();
      for (const n of names) if (n !== chefName) engine.castChefVote(ids[n]!, ids[chefName]!);
      engine.tallyChefVoteAndProceed();
      engine.proceedFromChefRevealToDiscussion();
      engine.endDay1Discussion(); // -> NIGHT 1
      engine.resolveNightAndProceed(); // nobody acted -> MORNING, no death
      engine.proceedFromMorningToDay();
      engine.endDayDiscussion();

      const filler = names.find((n) => n !== loupVertId && n !== pretreId && n !== chefName)!;
      const alive = engine.getPublicState().players.filter((p) => p.isAlive).map((p) => p.id);
      const votes: Record<string, string> = {};
      for (const id of alive) votes[id] = ids[filler]!;
      castDayVotesInOrder(engine, votes);
      engine.proceedFromDayVoteResultToNight(); // -> NIGHT 2

      return { engine, ids, loupVertId: ids[loupVertId]!, pretreId: ids[pretreId]! };
    }

    it("a correct PRETRE guess strips the victim and grants a one-night borrowed prompt, including self-target eligibility", () => {
      const { engine, loupVertId, pretreId } = bootToNight2WithPretre(2);
      const outcome = engine.submitLoupVertGuess(loupVertId, pretreId, "PRETRE" as any);
      expect(outcome.correct).toBe(true);
      expect(outcome.grantedPowerRoleId).toBe("PRETRE");

      const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
      expect(roles.get(pretreId)).toBe("VILLAGEOIS");

      const prompt = engine.getLoupVertStolenPowerPrompt(loupVertId);
      expect(prompt).not.toBeNull();
      expect(prompt!.actionType).toBe("PRETRE_SHOOT");
      // Borrowed prompt is built against the stripped source's own player
      // object — his own id (the original Prêtre) stays a valid target.
      expect(prompt!.eligibleTargetIds).toContain(pretreId);
    });

    it("using the borrowed shot on a non-wolf kills the STRIPPED SOURCE, never the Loup Vert himself", () => {
      const { engine, loupVertId, pretreId } = bootToNight2WithPretre(2);
      engine.submitLoupVertGuess(loupVertId, pretreId, "PRETRE" as any);
      // Target the stripped source's own id — now VILLAGEOIS (not a wolf),
      // so this exercises the MISS branch through the borrowed-power path.
      engine.submitLoupVertStolenPowerAction(loupVertId, "PRETRE_SHOOT", pretreId);
      // Missed (pretreId, now VILLAGEOIS, isn't a wolf) — the borrowed
      // power kills the STRIPPED SOURCE (the original Prêtre), not the Loup Vert.
      expect(engine.getPublicState().players.find((p) => p.id === pretreId)!.isAlive).toBe(false);
      expect(engine.getPublicState().players.find((p) => p.id === loupVertId)!.isAlive).toBe(true);
    });
  });
});
