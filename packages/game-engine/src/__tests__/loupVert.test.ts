import { describe, expect, it } from "vitest";
import { GameEngine } from "../engine/GameEngine";
import { castDayVotesInOrder, seededRng } from "./helpers";

/**
 * Boots a 6-player game (LOUP_VERT, CHASSEUR, VOYANTE + 3 plain
 * villagers), elects one of the villagers Chef, runs day 1 discussion and
 * an uneventful night 1 (nobody guesses — the Loup Vert can't yet), then
 * eliminates one filler villager by day vote to reach NIGHT 2, where his
 * guess power first becomes available.
 */
function bootToNight2(seed: number) {
  const names = ["LoupVert", "Chasseur", "Voyante", "Chef", "V2", "V3"];
  const engine = GameEngine.createGame(
    { roleCounts: { LOUP_VERT: 1, CHASSEUR: 1, VOYANTE: 1 } },
    seededRng(seed),
  );
  const ids: Record<string, string> = {};
  for (const n of names) ids[n] = engine.addPlayer(n).id;
  engine.startGame();

  const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
  const loupVertName = names.find((n) => roles.get(ids[n]!) === "LOUP_VERT")!;
  const chasseurName = names.find((n) => roles.get(ids[n]!) === "CHASSEUR")!;
  const voyanteName = names.find((n) => roles.get(ids[n]!) === "VOYANTE")!;
  const villagerNames = names.filter(
    (n) => n !== loupVertName && n !== chasseurName && n !== voyanteName,
  );
  const chefName = villagerNames[0]!;
  const fillerNames = villagerNames.slice(1); // 2 plain villagers, safe day-vote fodder

  engine.volunteerForChef(ids[chefName]!);
  engine.forceStartChefDebate();
  engine.advanceChefSpeaker();
  for (const n of names) if (n !== chefName) engine.castChefVote(ids[n]!, ids[chefName]!);
  engine.tallyChefVoteAndProceed();
  engine.proceedFromChefRevealToDiscussion(); // -> DAY_1_DISCUSSION
  engine.endDay1Discussion(); // -> NIGHT 1
  engine.resolveNightAndProceed(); // nobody acted -> MORNING, no death
  engine.proceedFromMorningToDay(); // -> DAY_DISCUSSION (day 2)
  engine.endDayDiscussion(); // force-skip straight to DAY_VOTE (also skips CHEF_SECOND_DEBATE)

  const victim = fillerNames[0]!;
  const votes: Record<string, string> = {};
  for (const n of names) votes[ids[n]!] = ids[victim]!;
  castDayVotesInOrder(engine, votes); // eliminates `victim` -> DAY_VOTE_RESULT
  engine.proceedFromDayVoteResultToNight(); // -> NIGHT 2

  return {
    engine,
    ids,
    loupVertId: ids[loupVertName]!,
    chasseurId: ids[chasseurName]!,
    voyanteId: ids[voyanteName]!,
    survivingFiller: ids[fillerNames[1]!]!,
  };
}

describe("Loup Vert", () => {
  it("cannot guess on night 1", () => {
    const names = ["LoupVert", "Chasseur", "Voyante", "Chef", "V2", "V3"];
    const engine = GameEngine.createGame(
      { roleCounts: { LOUP_VERT: 1, CHASSEUR: 1, VOYANTE: 1 } },
      seededRng(1),
    );
    const ids: Record<string, string> = {};
    for (const n of names) ids[n] = engine.addPlayer(n).id;
    engine.startGame();
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const loupVertName = names.find((n) => roles.get(ids[n]!) === "LOUP_VERT")!;
    const chefName = names.find((n) => n !== loupVertName)!;
    engine.volunteerForChef(ids[chefName]!);
    engine.forceStartChefDebate();
    engine.advanceChefSpeaker();
    for (const n of names) if (n !== chefName) engine.castChefVote(ids[n]!, ids[chefName]!);
    engine.tallyChefVoteAndProceed();
    engine.proceedFromChefRevealToDiscussion();
    engine.endDay1Discussion(); // -> NIGHT 1

    expect(engine.hasLoupVertGuessedTonight(ids[loupVertName]!)).toBe(true); // night 1: no attempt possible
    expect(() =>
      engine.submitLoupVertGuess(ids[loupVertName]!, ids[chefName]!, "VOYANTE"),
    ).toThrow();
  });

  it("wrong guesses cost nothing and can be retried the following night", () => {
    const { engine, loupVertId, voyanteId } = bootToNight2(2);
    // Voyante is not a CHASSEUR — guaranteed wrong guess.
    const outcome = engine.submitLoupVertGuess(loupVertId, voyanteId, "CHASSEUR");
    expect(outcome).toEqual({ correct: false, permanent: false, grantedPowerRoleId: null });
    // Victim keeps their real role — nothing was stolen.
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    expect(roles.get(voyanteId)).toBe("VOYANTE");
    // Only one attempt per night.
    expect(() => engine.submitLoupVertGuess(loupVertId, voyanteId, "VOYANTE")).toThrow();
  });

  it("a correct non-Chasseur guess steals the power for one night and strips the victim to VILLAGEOIS", () => {
    const { engine, loupVertId, voyanteId } = bootToNight2(2);
    const outcome = engine.submitLoupVertGuess(loupVertId, voyanteId, "VOYANTE");
    expect(outcome.correct).toBe(true);
    expect(outcome.permanent).toBe(false);
    expect(outcome.grantedPowerRoleId).toBe("VOYANTE");

    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    expect(roles.get(voyanteId)).toBe("VILLAGEOIS"); // permanently demoted

    // The stolen power is usable THIS night, reusing the Voyante's own
    // (empty) inspection history via her InternalPlayer record.
    const prompt = engine.getLoupVertStolenPowerPrompt(loupVertId);
    expect(prompt).not.toBeNull();
    expect(prompt!.actionType).toBe("INSPECT");
  });

  it("a correct CHASSEUR guess grants the permanent revenge-shot instead of a one-night power", () => {
    const { engine, loupVertId, chasseurId } = bootToNight2(2);
    const outcome = engine.submitLoupVertGuess(loupVertId, chasseurId, "CHASSEUR");
    expect(outcome.correct).toBe(true);
    expect(outcome.permanent).toBe(true);
    expect(outcome.grantedPowerRoleId).toBe("CHASSEUR");

    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    expect(roles.get(chasseurId)).toBe("VILLAGEOIS"); // the real Chasseur lost it for good

    // No one-night stolen-power prompt for CHASSEUR — it's not a night action.
    expect(engine.getLoupVertStolenPowerPrompt(loupVertId)).toBeNull();
  });

  it("dying while holding the stolen Chasseur power still triggers a revenge shot", () => {
    const { engine, ids, loupVertId, chasseurId, survivingFiller } = bootToNight2(2);
    engine.submitLoupVertGuess(loupVertId, chasseurId, "CHASSEUR");
    // Resolve night 2 with no wolf kill (Loup Vert didn't cast KILL_VOTE) —
    // just to get back to a day phase so we can vote him out.
    engine.resolveNightAndProceed(); // -> MORNING
    engine.proceedFromMorningToDay(); // -> DAY_DISCUSSION
    engine.endDayDiscussion(); // -> DAY_VOTE

    const alive = engine
      .getPublicState()
      .players.filter((p) => p.isAlive)
      .map((p) => p.id);
    const votes: Record<string, string> = {};
    for (const id of alive) votes[id] = loupVertId;
    castDayVotesInOrder(engine, votes); // eliminates the Loup Vert

    expect(engine.getPublicState().players.find((p) => p.id === loupVertId)!.isAlive).toBe(false);
    // His permanent Chasseur power fired a pending shot exactly like a real Chasseur dying would.
    expect(engine.getPendingChasseurShooterIds()).toEqual([loupVertId]);

    engine.submitChasseurShot(loupVertId, survivingFiller);
    expect(engine.getPublicState().players.find((p) => p.id === survivingFiller)!.isAlive).toBe(false);
    void ids;
  });

  it("guessing a new role after CHASSEUR gives up the permanent power in favor of the new one-night power", () => {
    const { engine, loupVertId, chasseurId, voyanteId, survivingFiller } = bootToNight2(2);
    engine.submitLoupVertGuess(loupVertId, chasseurId, "CHASSEUR");
    let roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    expect(roles.get(chasseurId)).toBe("VILLAGEOIS");

    engine.resolveNightAndProceed();
    engine.proceedFromMorningToDay();
    engine.endDayDiscussion();
    const alive = engine.getPublicState().players.filter((p) => p.isAlive).map((p) => p.id);
    // Vote out the remaining plain filler villager — guaranteed not to be
    // the elected Chef, so this can't trip a Chef-succession blocker and
    // strand the phase before DAY_VOTE_RESULT.
    const votes: Record<string, string> = {};
    for (const id of alive) votes[id] = survivingFiller;
    castDayVotesInOrder(engine, votes);
    engine.proceedFromDayVoteResultToNight(); // -> NIGHT 3

    const outcome = engine.submitLoupVertGuess(loupVertId, voyanteId, "VOYANTE");
    expect(outcome.correct).toBe(true);
    expect(outcome.permanent).toBe(false);

    roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    // He no longer holds the permanent Chasseur trigger, per the house rule.
    // (No direct getter for loupVertHasChasseurPower outside getPrivateRoleExtras.)
    const extras = engine.getPrivateRoleExtras(loupVertId);
    expect(extras.loupVertHasChasseurPower).toBe(false);
    expect(extras.loupVertStolenPowerRoleId).toBe("VOYANTE");
  });

  it("joins the wolf room and appears in wolf-teammate lists", () => {
    const { engine, ids, loupVertId } = bootToNight2(2);
    expect(engine.getWolfRoomMemberIds()).toContain(loupVertId);
    // Solo wolf in this roster — teammates list is himself-excluded, i.e. empty.
    expect(engine.getWolfTeammates(loupVertId)).toEqual([]);
    void ids;
  });
});
