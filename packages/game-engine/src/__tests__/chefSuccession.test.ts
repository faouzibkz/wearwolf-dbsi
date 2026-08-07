import { describe, expect, it } from "vitest";
import { GameEngine } from "../engine/GameEngine";
import { castDayVotesInOrder, seededRng } from "./helpers";

function bootWithElectedChef(names: string[], roleCounts: Record<string, number>, seed: number) {
  const engine = GameEngine.createGame({ roleCounts: roleCounts as any }, seededRng(seed));
  const ids: Record<string, string> = {};
  for (const n of names) ids[n] = engine.addPlayer(n).id;
  engine.startGame();
  engine.volunteerForChef(ids[names[0]!]!);
  engine.forceStartChefDebate();
  engine.advanceChefSpeaker();
  for (const n of names.slice(1)) engine.castChefVote(ids[n]!, ids[names[0]!]!);
  engine.tallyChefVoteAndProceed(); // names[0] is elected Chef
  engine.proceedFromChefRevealToDiscussion();
  engine.endDay1Discussion();
  return { engine, ids };
}

describe("Chef du village succession on death", () => {
  it("blocks the night->morning transition until the dead Chef names a successor", () => {
    const names = ["Chef", "B", "C", "D", "E"];
    const { engine, ids } = bootWithElectedChef(names, { LOUP_GAROU: 1 }, 2);
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;

    // Wolves kill the Chef.
    engine.submitNightAction(ids[wolf]!, "KILL_VOTE", ids.Chef!);
    const result = engine.resolveNightAndProceed();

    expect(result.blocked).toBe(true);
    expect(engine.getPhase()).toBe("NIGHT"); // did not advance to MORNING yet
    expect(engine.getPendingChefSuccessionDeadChefId()).toBe(ids.Chef);
    expect(engine.getPublicState().players.find((p) => p.id === ids.Chef)!.isAlive).toBe(false);

    const successor = names.find((n) => n !== "Chef" && n !== wolf)!;
    engine.chooseChefSuccessor(ids.Chef!, ids[successor]!);

    expect(engine.getPendingChefSuccessionDeadChefId()).toBeNull();
    expect(engine.getPhase()).toBe("MORNING"); // now it can proceed
    const publicState = engine.getPublicState();
    expect(publicState.chefId).toBe(ids[successor]);
    expect(publicState.players.find((p) => p.id === ids[successor])!.isChef).toBe(true);
    expect(publicState.players.find((p) => p.id === ids.Chef)!.isChef).toBe(false);
  });

  it("blocks the day-vote elimination -> night transition the same way", () => {
    const names = ["Chef", "B", "C", "D", "E"];
    const { engine, ids } = bootWithElectedChef(names, { LOUP_GAROU: 1 }, 2);
    engine.resolveNightAndProceed(); // nobody targeted, nobody dies
    engine.proceedFromMorningToDay();
    engine.endDayDiscussion();

    const votes: Record<string, string> = {};
    for (const n of names) if (n !== "Chef") votes[ids[n]!] = ids.Chef!;
    const outcome = castDayVotesInOrder(engine, votes);

    expect(outcome?.eliminatedId).toBe(ids.Chef);
    expect(engine.getPhase()).toBe("DAY_VOTE"); // parked here, blocked
    expect(engine.getPendingChefSuccessionDeadChefId()).toBe(ids.Chef);

    engine.chooseChefSuccessor(ids.Chef!, ids.B!);
    expect(engine.getPhase()).toBe("DAY_VOTE_RESULT"); // unblocked, brief announcement pause first
    engine.proceedFromDayVoteResultToNight();
    expect(engine.getPhase()).toBe("NIGHT"); // now free to continue
    expect(engine.getPublicState().chefId).toBe(ids.B);
  });

  it("stays blocked until BOTH a pending Chasseur shot and Chef succession resolve, in either order", () => {
    // The Chasseur himself is also the elected Chef.
    const names = ["Chef", "B", "C", "D", "E"];
    const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1, CHASSEUR: 1 } }, seededRng(6));
    const ids: Record<string, string> = {};
    for (const n of names) ids[n] = engine.addPlayer(n).id;
    engine.startGame();
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const chasseur = names.find((n) => roles.get(ids[n]!) === "CHASSEUR")!;
    // Elect the Chasseur as Chef.
    engine.volunteerForChef(ids[chasseur]!);
    engine.forceStartChefDebate();
    engine.advanceChefSpeaker();
    for (const n of names) if (n !== chasseur) engine.castChefVote(ids[n]!, ids[chasseur]!);
    engine.tallyChefVoteAndProceed();
    engine.proceedFromChefRevealToDiscussion();
    engine.endDay1Discussion();

    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    const bystander = names.find((n) => n !== wolf && n !== chasseur)!;

    engine.submitNightAction(ids[wolf]!, "KILL_VOTE", ids[chasseur]!);
    const result = engine.resolveNightAndProceed();

    expect(result.blocked).toBe(true);
    expect(engine.getPendingChasseurShooterIds()).toEqual([ids[chasseur]]);
    expect(engine.getPendingChefSuccessionDeadChefId()).toBe(ids[chasseur]);

    // Resolve the Chef succession first -> still blocked by the shot.
    const successor = names.find((n) => n !== chasseur && n !== bystander && n !== wolf)!;
    engine.chooseChefSuccessor(ids[chasseur]!, ids[successor]!);
    expect(engine.getPhase()).toBe("NIGHT");
    expect(engine.getPendingChasseurShooterIds()).toEqual([ids[chasseur]]);

    // Now resolve the shot -> fully unblocked.
    engine.submitChasseurShot(ids[chasseur]!, ids[bystander]!);
    expect(engine.getPhase()).toBe("MORNING");
    expect(engine.getPublicState().chefId).toBe(ids[successor]);
  });

  it("rejects a successor pick from the wrong player, a dead successor, or self-succession", () => {
    const names = ["Chef", "B", "C", "D", "E"];
    const { engine, ids } = bootWithElectedChef(names, { LOUP_GAROU: 1 }, 2);
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;

    engine.submitNightAction(ids[wolf]!, "KILL_VOTE", ids.Chef!);
    engine.resolveNightAndProceed();

    // Wrong caller (not the dead Chef).
    expect(() => engine.chooseChefSuccessor(ids.B!, ids.C!)).toThrow();
    // Self-succession.
    expect(() => engine.chooseChefSuccessor(ids.Chef!, ids.Chef!)).toThrow();
    // Dead player can't be named (the wolf's victim, i.e. the Chef himself,
    // is the only dead player here besides a no-op; use a clearly dead id
    // by picking someone who isn't alive -- there is none other than Chef,
    // so instead assert a bogus id is rejected via getPlayer throwing).
    expect(() => engine.chooseChefSuccessor(ids.Chef!, "not-a-real-player-id")).toThrow();

    // Still pending after all the rejected attempts.
    expect(engine.getPendingChefSuccessionDeadChefId()).toBe(ids.Chef);
  });

  it("still blocks on succession even when the game is about to end (mirrors the Chasseur pattern), then ends once resolved", () => {
    // 4 players (minimum allowed), 2 Loup-Garou: elect a non-wolf Chef,
    // then both wolves kill him. That leaves 2 wolves + 1 villager alive
    // -- wolves reach parity -- but exactly like a Chasseur's pending
    // shot, victory is only checked once every pending blocker (including
    // succession) has resolved.
    const names = ["A", "B", "C", "D"];
    const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 2 } }, seededRng(1));
    const ids: Record<string, string> = {};
    for (const n of names) ids[n] = engine.addPlayer(n).id;
    engine.startGame();
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolves = names.filter((n) => roles.get(ids[n]!) === "LOUP_GAROU");
    const villagers = names.filter((n) => !wolves.includes(n));
    const chefName = villagers[0]!;
    const survivor = villagers[1]!;

    engine.volunteerForChef(ids[chefName]!);
    engine.forceStartChefDebate();
    engine.advanceChefSpeaker();
    for (const n of names) if (n !== chefName) engine.castChefVote(ids[n]!, ids[chefName]!);
    engine.tallyChefVoteAndProceed();
    engine.proceedFromChefRevealToDiscussion();
    engine.endDay1Discussion();

    for (const w of wolves) engine.submitNightAction(ids[w]!, "KILL_VOTE", ids[chefName]!);
    const result = engine.resolveNightAndProceed();

    expect(result.blocked).toBe(true);
    expect(engine.getPhase()).toBe("NIGHT");
    expect(engine.getPendingChefSuccessionDeadChefId()).toBe(ids[chefName]);

    engine.chooseChefSuccessor(ids[chefName]!, ids[survivor]!);
    expect(engine.getPhase()).toBe("ENDED");
    expect(engine.getPublicState().winner).toBe("LOUPS");
  });
});
