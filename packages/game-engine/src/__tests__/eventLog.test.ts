import { describe, expect, it } from "vitest";
import { GameEngine } from "../engine/GameEngine";
import { castDayVotesInOrder, seededRng } from "./helpers";
import type { GameEvent } from "../events";

/**
 * Cahier de charge #2 §17.4a — the structured event journal that Performance
 * Score v2 / Badges / Leaderboards all read generically (by `type`/`actorId`)
 * instead of re-deriving "who did what" from scratch. See events.ts for the
 * full GameEvent union and where each variant is recorded.
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
  const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
  return { engine, ids, roles };
}

function findByRole(names: string[], ids: Record<string, string>, roles: Map<string, string>, roleId: string) {
  return names.find((n) => roles.get(ids[n]!) === roleId)!;
}

function eventsOfType<T extends GameEvent["type"]>(
  engine: GameEngine,
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return engine.getEventLog().filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

describe("Structured event journal (GameEvent / eventLog)", () => {
  it("records a Voyante inspection with the target's real role", () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    const { engine, ids, roles } = bootToNight1(names, { LOUP_GAROU: 1, VOYANTE: 1 }, 10);
    const wolf = findByRole(names, ids, roles, "LOUP_GAROU");
    const voyante = findByRole(names, ids, roles, "VOYANTE");

    engine.submitNightAction(ids[voyante]!, "INSPECT", ids[wolf]!);
    engine.resolveNightAndProceed();

    const inspections = eventsOfType(engine, "VOYANTE_INSPECT");
    expect(inspections).toHaveLength(1);
    expect(inspections[0]).toMatchObject({
      night: 1,
      actorId: ids[voyante]!,
      targetId: ids[wolf]!,
      targetRoleId: "LOUP_GAROU",
      result: "LOUP",
    });

    // getPlayerEvents filters generically by actorId, regardless of type.
    expect(engine.getPlayerEvents(ids[voyante]!)).toEqual(inspections);
  });

  it("records a successful Salvateur protection and the wolf attack it blocked", () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    const { engine, ids, roles } = bootToNight1(names, { LOUP_GAROU: 1, SALVATEUR: 1 }, 11);
    const wolf = findByRole(names, ids, roles, "LOUP_GAROU");
    const salvateur = findByRole(names, ids, roles, "SALVATEUR");
    const chef = names[0]!;
    const target = names.find((n) => n !== wolf && n !== salvateur && n !== chef)!;

    engine.submitNightAction(ids[wolf]!, "KILL_VOTE", ids[target]!);
    engine.submitNightAction(ids[salvateur]!, "PROTECT", ids[target]!);
    engine.resolveNightAndProceed();

    expect(eventsOfType(engine, "SALVATEUR_PROTECT")).toEqual([
      { type: "SALVATEUR_PROTECT", night: 1, actorId: ids[salvateur]!, targetId: ids[target]!, saved: true },
    ]);
    expect(eventsOfType(engine, "WOLF_KILL_ATTEMPT")).toEqual([
      { type: "WOLF_KILL_ATTEMPT", night: 1, targetId: ids[target]!, landed: false },
    ]);
    expect(engine.getPublicState().players.find((p) => p.id === ids[target]!)!.isAlive).toBe(true);
  });

  it("records a wolf kill that lands when nobody intervenes", () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    const { engine, ids, roles } = bootToNight1(names, { LOUP_GAROU: 1 }, 12);
    const wolf = findByRole(names, ids, roles, "LOUP_GAROU");
    const chef = names[0]!;
    const target = names.find((n) => n !== wolf && n !== chef)!;

    engine.submitNightAction(ids[wolf]!, "KILL_VOTE", ids[target]!);
    engine.resolveNightAndProceed();

    expect(eventsOfType(engine, "WOLF_KILL_ATTEMPT")).toEqual([
      { type: "WOLF_KILL_ATTEMPT", night: 1, targetId: ids[target]!, landed: true },
    ]);
    expect(eventsOfType(engine, "SALVATEUR_PROTECT")).toEqual([]);
  });

  it("records a Sorcière heal that saves the wolves' target", () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    const { engine, ids, roles } = bootToNight1(names, { LOUP_GAROU: 1, SORCIERE: 1 }, 13);
    const wolf = findByRole(names, ids, roles, "LOUP_GAROU");
    const sorciere = findByRole(names, ids, roles, "SORCIERE");
    const chef = names[0]!;
    const target = names.find((n) => n !== wolf && n !== sorciere && n !== chef)!;

    engine.submitNightAction(ids[wolf]!, "KILL_VOTE", ids[target]!);
    engine.submitNightAction(ids[sorciere]!, "HEAL");
    engine.resolveNightAndProceed();

    expect(eventsOfType(engine, "SORCIERE_HEAL")).toEqual([
      { type: "SORCIERE_HEAL", night: 1, actorId: ids[sorciere]!, targetId: ids[target]! },
    ]);
    expect(eventsOfType(engine, "WOLF_KILL_ATTEMPT")).toEqual([
      { type: "WOLF_KILL_ATTEMPT", night: 1, targetId: ids[target]!, landed: false },
    ]);
  });

  it("records a Sorcière poison, flagging whether it killed a wolf", () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    // Two wolves so poisoning one still leaves the pack alive (avoids the
    // "no wolves left" instant village victory short-circuiting anything).
    const { engine, ids, roles } = bootToNight1(names, { LOUP_GAROU: 2, SORCIERE: 1 }, 14);
    const wolves = names.filter((n) => roles.get(ids[n]!) === "LOUP_GAROU");
    const sorciere = findByRole(names, ids, roles, "SORCIERE");

    engine.submitNightAction(ids[sorciere]!, "POISON", ids[wolves[0]!]!);
    engine.resolveNightAndProceed();

    expect(eventsOfType(engine, "SORCIERE_POISON")).toEqual([
      {
        type: "SORCIERE_POISON",
        night: 1,
        actorId: ids[sorciere]!,
        targetId: ids[wolves[0]!]!,
        targetRoleId: "LOUP_GAROU",
        killedWolf: true,
      },
    ]);
  });

  it("records a poison against a village-team player as killedWolf: false", () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    const { engine, ids, roles } = bootToNight1(names, { LOUP_GAROU: 1, SORCIERE: 1 }, 15);
    const sorciere = findByRole(names, ids, roles, "SORCIERE");
    const chef = names[0]!;
    const wolf = findByRole(names, ids, roles, "LOUP_GAROU");
    const villager = names.find((n) => n !== sorciere && n !== chef && n !== wolf)!;

    engine.submitNightAction(ids[sorciere]!, "POISON", ids[villager]!);
    engine.resolveNightAndProceed();

    expect(eventsOfType(engine, "SORCIERE_POISON")).toEqual([
      {
        type: "SORCIERE_POISON",
        night: 1,
        actorId: ids[sorciere]!,
        targetId: ids[villager]!,
        targetRoleId: "VILLAGEOIS",
        killedWolf: false,
      },
    ]);
  });

  it("records a Corbeau mark", () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    const { engine, ids, roles } = bootToNight1(names, { LOUP_GAROU: 1, CORBEAU: 1 }, 16);
    const corbeau = findByRole(names, ids, roles, "CORBEAU");
    const chef = names[0]!;
    const target = names.find((n) => n !== corbeau && n !== chef)!;

    engine.submitNightAction(ids[corbeau]!, "MARK", ids[target]!);
    engine.resolveNightAndProceed();

    expect(eventsOfType(engine, "CORBEAU_MARK")).toEqual([
      { type: "CORBEAU_MARK", night: 1, actorId: ids[corbeau]!, targetId: ids[target]! },
    ]);
  });

  it("records a wrong Alien guess", () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    const { engine, ids, roles } = bootToNight1(names, { LOUP_GAROU: 1, ALIEN: 1, VOYANTE: 1 }, 17);
    const alien = findByRole(names, ids, roles, "ALIEN");
    const voyante = findByRole(names, ids, roles, "VOYANTE");

    engine.submitNightAction(ids[alien]!, "ALIEN_GUESS", ids[voyante]!, "CHASSEUR");
    engine.resolveNightAndProceed();

    expect(eventsOfType(engine, "ALIEN_GUESS")).toEqual([
      {
        type: "ALIEN_GUESS",
        night: 1,
        actorId: ids[alien]!,
        targetId: ids[voyante]!,
        guessedRoleId: "CHASSEUR",
        correct: false,
      },
    ]);
  });

  it("records a correct Alien guess", () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    const { engine, ids, roles } = bootToNight1(names, { LOUP_GAROU: 1, ALIEN: 1, VOYANTE: 1 }, 18);
    const alien = findByRole(names, ids, roles, "ALIEN");
    const voyante = findByRole(names, ids, roles, "VOYANTE");

    engine.submitNightAction(ids[alien]!, "ALIEN_GUESS", ids[voyante]!, "VOYANTE");
    engine.resolveNightAndProceed();

    expect(eventsOfType(engine, "ALIEN_GUESS")).toEqual([
      {
        type: "ALIEN_GUESS",
        night: 1,
        actorId: ids[alien]!,
        targetId: ids[voyante]!,
        guessedRoleId: "VOYANTE",
        correct: true,
      },
    ]);
  });

  it("records Loup Vert guesses (right and wrong) and a Chasseur revenge shot", () => {
    const names = ["LoupVert", "Chasseur", "Voyante", "Chef", "V2", "V3"];
    const engine = GameEngine.createGame(
      { roleCounts: { LOUP_VERT: 1, CHASSEUR: 1, VOYANTE: 1 } },
      seededRng(19),
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
    const fillerName = villagerNames[1]!;

    engine.volunteerForChef(ids[chefName]!);
    engine.forceStartChefDebate();
    engine.advanceChefSpeaker();
    for (const n of names) if (n !== chefName) engine.castChefVote(ids[n]!, ids[chefName]!);
    engine.tallyChefVoteAndProceed();
    engine.proceedFromChefRevealToDiscussion();
    engine.endDay1Discussion(); // -> NIGHT 1
    engine.resolveNightAndProceed(); // nobody acted
    engine.proceedFromMorningToDay();
    engine.endDayDiscussion();
    const votes: Record<string, string> = {};
    for (const n of names) votes[ids[n]!] = ids[fillerName]!;
    castDayVotesInOrder(engine, votes); // -> DAY_VOTE_RESULT
    engine.proceedFromDayVoteResultToNight(); // -> NIGHT 2

    // Wrong guess first.
    engine.submitLoupVertGuess(ids[loupVertName]!, ids[voyanteName]!, "CHASSEUR");
    expect(eventsOfType(engine, "LOUP_VERT_GUESS")).toEqual([
      {
        type: "LOUP_VERT_GUESS",
        night: 2,
        actorId: ids[loupVertName]!,
        targetId: ids[voyanteName]!,
        guessedRoleId: "CHASSEUR",
        correct: false,
      },
    ]);

    engine.resolveNightAndProceed();
    engine.proceedFromMorningToDay();
    engine.endDayDiscussion();
    const alive = engine.getPublicState().players.filter((p) => p.isAlive).map((p) => p.id);
    const votes2: Record<string, string> = {};
    for (const id of alive) votes2[id] = ids[voyanteName]!; // eliminate the Voyante, not the Chef
    castDayVotesInOrder(engine, votes2);
    engine.proceedFromDayVoteResultToNight(); // -> NIGHT 3

    // Correct CHASSEUR guess now grants the permanent revenge trigger.
    engine.submitLoupVertGuess(ids[loupVertName]!, ids[chasseurName]!, "CHASSEUR");
    const guesses = eventsOfType(engine, "LOUP_VERT_GUESS");
    expect(guesses).toHaveLength(2);
    expect(guesses[1]).toMatchObject({
      actorId: ids[loupVertName]!,
      targetId: ids[chasseurName]!,
      guessedRoleId: "CHASSEUR",
      correct: true,
    });

    engine.resolveNightAndProceed();
    engine.proceedFromMorningToDay();
    engine.endDayDiscussion();
    const alive2 = engine.getPublicState().players.filter((p) => p.isAlive).map((p) => p.id);
    const votes3: Record<string, string> = {};
    for (const id of alive2) votes3[id] = ids[loupVertName]!;
    castDayVotesInOrder(engine, votes3); // eliminates the Loup Vert -> permanent Chasseur trigger fires

    expect(engine.getPendingChasseurShooterIds()).toEqual([ids[loupVertName]!]);
    engine.submitChasseurShot(ids[loupVertName]!, ids[chasseurName]!);

    expect(eventsOfType(engine, "CHASSEUR_SHOT")).toEqual([
      {
        type: "CHASSEUR_SHOT",
        actorId: ids[loupVertName]!,
        targetId: ids[chasseurName]!,
        // The real Chasseur was permanently stripped to VILLAGEOIS the
        // moment the Loup Vert correctly guessed CHASSEUR (see LoupVert.ts)
        // — the power transferred, the roleId did not.
        targetRoleId: "VILLAGEOIS",
      },
    ]);
  });

  it("records a Barbie reveal that unmasks a wolf", () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    const { engine, ids, roles } = bootToNight1(names, { LOUP_GAROU: 1, BARBIE: 1 }, 20);
    // resolveNightAndProceed to reach DAY_DISCUSSION where Barbie can act.
    engine.resolveNightAndProceed();
    engine.proceedFromMorningToDay();

    const barbie = findByRole(names, ids, roles, "BARBIE");
    const wolf = findByRole(names, ids, roles, "LOUP_GAROU");
    engine.useBarbiePower(ids[barbie]!, ids[wolf]!);

    expect(eventsOfType(engine, "BARBIE_REVEAL")).toEqual([
      {
        type: "BARBIE_REVEAL",
        actorId: ids[barbie]!,
        targetId: ids[wolf]!,
        targetRoleId: "LOUP_GAROU",
        outcome: "WOLF_DIED_BARBIE_CHEF",
      },
    ]);
  });

  it("records a Barbie misfire against a non-wolf (both die)", () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    const { engine, ids, roles } = bootToNight1(names, { LOUP_GAROU: 1, BARBIE: 1 }, 21);
    engine.resolveNightAndProceed();
    engine.proceedFromMorningToDay();

    const barbie = findByRole(names, ids, roles, "BARBIE");
    const chef = names[0]!;
    const villager = names.find((n) => n !== barbie && n !== chef && roles.get(ids[n]!) !== "LOUP_GAROU")!;
    engine.useBarbiePower(ids[barbie]!, ids[villager]!);

    expect(eventsOfType(engine, "BARBIE_REVEAL")).toEqual([
      {
        type: "BARBIE_REVEAL",
        actorId: ids[barbie]!,
        targetId: ids[villager]!,
        targetRoleId: roles.get(ids[villager]!),
        outcome: "BOTH_DIED",
      },
    ]);
  });

  it("records every day-vote cast and the resulting elimination", () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    const { engine, ids, roles } = bootToNight1(names, { LOUP_GAROU: 1 }, 22);
    engine.resolveNightAndProceed();
    engine.proceedFromMorningToDay();
    engine.endDayDiscussion();

    const wolf = findByRole(names, ids, roles, "LOUP_GAROU");
    const votes: Record<string, string> = {};
    for (const n of names) votes[ids[n]!] = ids[wolf]!;
    castDayVotesInOrder(engine, votes);

    // Day 1 is DAY_1_DISCUSSION only (no vote) — the first DAY_VOTE happens
    // on day 2, once night 1 has resolved and morning has passed.
    const casts = eventsOfType(engine, "DAY_VOTE_CAST");
    expect(casts).toHaveLength(names.length);
    for (const n of names) {
      expect(casts).toContainEqual({
        type: "DAY_VOTE_CAST",
        day: 2,
        round: 1,
        actorId: ids[n]!,
        targetId: ids[wolf]!,
      });
    }

    expect(eventsOfType(engine, "DAY_VOTE_ELIMINATION")).toEqual([
      { type: "DAY_VOTE_ELIMINATION", day: 2, round: 1, targetId: ids[wolf]! },
    ]);
  });

  it("the event log is generic/order-preserving across a mixed night (Voyante + Salvateur + wolf kill)", () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    const { engine, ids, roles } = bootToNight1(
      names,
      { LOUP_GAROU: 1, VOYANTE: 1, SALVATEUR: 1 },
      23,
    );
    const wolf = findByRole(names, ids, roles, "LOUP_GAROU");
    const voyante = findByRole(names, ids, roles, "VOYANTE");
    const salvateur = findByRole(names, ids, roles, "SALVATEUR");
    const chef = names[0]!;
    const villager = names.find(
      (n) => n !== wolf && n !== voyante && n !== salvateur && n !== chef,
    )!;

    engine.submitNightAction(ids[wolf]!, "KILL_VOTE", ids[villager]!);
    engine.submitNightAction(ids[voyante]!, "INSPECT", ids[wolf]!);
    engine.submitNightAction(ids[salvateur]!, "PROTECT", ids[chef]!); // doesn't save the actual target
    engine.resolveNightAndProceed();

    const types = engine.getEventLog().map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining(["VOYANTE_INSPECT", "SALVATEUR_PROTECT", "WOLF_KILL_ATTEMPT"]),
    );
    expect(eventsOfType(engine, "SALVATEUR_PROTECT")[0]!.saved).toBe(false);
    expect(eventsOfType(engine, "WOLF_KILL_ATTEMPT")[0]!.landed).toBe(true);
    expect(engine.getPublicState().players.find((p) => p.id === ids[villager]!)!.isAlive).toBe(false);
  });

  it("serialize()/deserialize() round-trips the event log", () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    const { engine, ids, roles } = bootToNight1(names, { LOUP_GAROU: 1, VOYANTE: 1 }, 24);
    const wolf = findByRole(names, ids, roles, "LOUP_GAROU");
    const voyante = findByRole(names, ids, roles, "VOYANTE");
    engine.submitNightAction(ids[voyante]!, "INSPECT", ids[wolf]!);
    engine.resolveNightAndProceed();

    const before = engine.getEventLog();
    expect(before.length).toBeGreaterThan(0);

    const restored = GameEngine.deserialize(JSON.parse(JSON.stringify(engine.serialize())));
    expect(restored.getEventLog()).toEqual(before);
  });

  it("deserialize() defaults a missing eventLog to [] for pre-existing saved games", () => {
    const names = ["A", "B", "C", "D"];
    const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1 } as any }, seededRng(25));
    for (const n of names) engine.addPlayer(n);
    const serialized = engine.serialize() as Record<string, unknown>;
    delete serialized.eventLog;
    const restored = GameEngine.deserialize(JSON.parse(JSON.stringify(serialized)));
    expect(restored.getEventLog()).toEqual([]);
  });
});
