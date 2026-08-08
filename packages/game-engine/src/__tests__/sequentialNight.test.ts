import { describe, expect, it } from "vitest";
import { GameEngine } from "../engine/GameEngine";
import { seededRng, castDayVotesInOrder } from "./helpers";

/**
 * Cahier de charge #2, §17.1 — SEQUENTIAL night mode (GameConfig.nightMode).
 * All of packages/game-engine's existing 130 tests exercise SIMULTANEOUS
 * mode (the untouched default) and stay green unmodified — this file is
 * entirely additive coverage for the new opt-in path.
 */

function bootToNight1(seed: number, roleCounts: Record<string, number>, names: string[]) {
  const engine = GameEngine.createGame(
    { roleCounts: roleCounts as any, nightMode: "SEQUENTIAL" },
    seededRng(seed),
  );
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

/** Same shape as loupVert.test.ts's bootToNight2, but SEQUENTIAL mode, and drives night 1 to completion via the step machinery instead of leaving it unresolved. */
function bootToNight2(seed: number) {
  const names = ["LoupVert", "Voyante", "Chef", "V2", "V3"];
  const engine = GameEngine.createGame(
    { roleCounts: { LOUP_VERT: 1, VOYANTE: 1 }, nightMode: "SEQUENTIAL" },
    seededRng(seed),
  );
  const ids: Record<string, string> = {};
  for (const n of names) ids[n] = engine.addPlayer(n).id;
  engine.startGame();
  const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
  const loupVertName = names.find((n) => roles.get(ids[n]!) === "LOUP_VERT")!;
  const voyanteName = names.find((n) => roles.get(ids[n]!) === "VOYANTE")!;
  const villagerNames = names.filter((n) => n !== loupVertName && n !== voyanteName);
  const chefName = villagerNames[0]!;
  const fillerNames = villagerNames.slice(1);

  engine.volunteerForChef(ids[chefName]!);
  engine.forceStartChefDebate();
  engine.advanceChefSpeaker();
  for (const n of names) if (n !== chefName) engine.castChefVote(ids[n]!, ids[chefName]!);
  engine.tallyChefVoteAndProceed();
  engine.proceedFromChefRevealToDiscussion();
  engine.endDay1Discussion(); // -> NIGHT 1 (SEQUENTIAL)

  // Drive every step of night 1 forward via force-advance (nobody needs to
  // act meaningfully — this is purely to reach night 2 with clean state).
  while (engine.getCurrentNightStepRoleIds() !== null) engine.forceAdvanceNightStep();

  engine.proceedFromMorningToDay();
  engine.endDayDiscussion();
  const victim = fillerNames[0]!;
  const votes: Record<string, string> = {};
  for (const n of names) votes[ids[n]!] = ids[victim]!;
  castDayVotesInOrder(engine, votes);
  engine.proceedFromDayVoteResultToNight(); // -> NIGHT 2 (SEQUENTIAL)

  return { engine, ids, loupVertId: ids[loupVertName]!, voyanteId: ids[voyanteName]! };
}

describe("Sequential night mode (cahier de charge #2, §17.1)", () => {
  it("defaults to the same order as nightPriority, one step per role", () => {
    const names = ["Chef", "Salvateur", "Voyante", "Sorciere", "Wolf"];
    const { engine } = bootToNight1(1, { SALVATEUR: 1, VOYANTE: 1, SORCIERE: 1, LOUP_GAROU: 1 }, names);

    expect(engine.isSequentialNightMode()).toBe(true);
    expect(engine.getNightStepProgress()).toEqual({ stepIndex: 1, totalSteps: 4 });
    expect(engine.getCurrentNightStepRoleIds()).toEqual(["SALVATEUR"]);

    const prompts = engine.getNightPrompts();
    expect(prompts.map((p) => p.player.roleId)).toEqual(["SALVATEUR"]);
  });

  it("advances through the full order (Salvateur -> Voyante -> Loups -> Sorciere) as each step completes", () => {
    const names = ["Chef", "Salvateur", "Voyante", "Sorciere", "Wolf", "V2"];
    const { engine, ids } = bootToNight1(
      2,
      { SALVATEUR: 1, VOYANTE: 1, SORCIERE: 1, LOUP_GAROU: 1 },
      names,
    );
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const idOf = (roleId: string) => names.map((n) => ids[n]!).find((id) => roles.get(id) === roleId)!;

    expect(engine.getCurrentNightStepRoleIds()).toEqual(["SALVATEUR"]);
    engine.submitNightAction(idOf("SALVATEUR"), "PROTECT", idOf("VOYANTE"));
    expect(engine.advanceNightStepIfComplete()).toBe(true);

    expect(engine.getCurrentNightStepRoleIds()).toEqual(["VOYANTE"]);
    engine.submitNightAction(idOf("VOYANTE"), "INSPECT", idOf("SORCIERE"));
    expect(engine.advanceNightStepIfComplete()).toBe(true);

    expect(engine.getCurrentNightStepRoleIds()).toEqual(["LOUP_GAROU"]);
    engine.submitNightAction(idOf("LOUP_GAROU"), "KILL_VOTE", ids.V2!);
    expect(engine.advanceNightStepIfComplete()).toBe(true);

    expect(engine.getCurrentNightStepRoleIds()).toEqual(["SORCIERE"]);
    // The wolves' step is already fully closed out at this point — her
    // prompt must already reflect their target (dependency safety,
    // preserved end-to-end under SEQUENTIAL mode, not just assumed from
    // SIMULTANEOUS mode's existing correctness).
    const sorciereContext = engine.getNightPrompts()[0]!.request.context as { attackedPlayerId: string };
    expect(sorciereContext.attackedPlayerId).toBe(ids.V2!);

    engine.submitNightAction(idOf("SORCIERE"), "SKIP");
    expect(engine.advanceNightStepIfComplete()).toBe(true);

    // No steps left -> the night auto-resolved and moved on.
    expect(engine.getCurrentNightStepRoleIds()).toBeNull();
    expect(engine.getPhase()).toBe("MORNING");
  });

  it("regular wolves and the Loup Blanc merge into a single step (same collective vote, never two turns)", () => {
    const names = ["Chef", "Wolf1", "Wolf2", "WolfBlanc", "V2"];
    const { engine, ids } = bootToNight1(3, { LOUP_GAROU: 2, LOUP_BLANC: 1 }, names);
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));

    expect(engine.getNightStepProgress().totalSteps).toBe(1); // one merged step, not three
    const stepRoleIds = engine.getCurrentNightStepRoleIds()!;
    expect(new Set(stepRoleIds)).toEqual(new Set(["LOUP_GAROU", "LOUP_BLANC"]));

    // Every wolf-team holder (regardless of exact roleId) is prompted at once, this step.
    const promptedIds = engine.getNightPrompts().map((p) => p.player.id);
    const wolfIds = names.map((n) => ids[n]!).filter((id) => roles.get(id) !== "VILLAGEOIS" && id !== ids.Chef);
    for (const id of wolfIds) expect(promptedIds).toContain(id);
  });

  it("a first-night-only role (Mowgli) gets a step on night 1 but not night 2+", () => {
    // Includes a lone wolf, kept alive throughout, purely so the game
    // doesn't instantly declare a "no wolves" VILLAGE victory the moment
    // night resolves — same reasoning as alien.test.ts's own rosters.
    const names = ["Chef", "Mowgli", "Wolf", "V2", "V3"];
    const { engine, ids, roles } = bootToNight1(4, { MOWGLI: 1, LOUP_GAROU: 1 }, names);
    const mowgliId = names.map((n) => ids[n]!).find((id) => roles.get(id) === "MOWGLI")!;
    const wolfId = names.map((n) => ids[n]!).find((id) => roles.get(id) === "LOUP_GAROU")!;

    expect(engine.getCurrentNightStepRoleIds()).toEqual(["MOWGLI"]); // priority 5, first step
    while (engine.getCurrentNightStepRoleIds() !== null) engine.forceAdvanceNightStep();
    expect(engine.getPhase()).toBe("MORNING");

    engine.proceedFromMorningToDay();
    engine.endDayDiscussion();
    const alive = engine.getPublicState().players.filter((p) => p.isAlive).map((p) => p.id);
    const votes: Record<string, string> = {};
    // Keep Mowgli, the wolf, and the Chef alive — only a plain filler
    // villager gets eliminated, so the game doesn't end here for reasons
    // unrelated to what this test is actually checking.
    const filler = alive.find(
      (id) => id !== mowgliId && id !== wolfId && id !== engine.getChefId(),
    )!;
    for (const id of alive) votes[id] = filler;
    castDayVotesInOrder(engine, votes);
    engine.proceedFromDayVoteResultToNight(); // -> NIGHT 2

    expect(engine.getCurrentNightStepRoleIds()).not.toEqual(["MOWGLI"]);
    // Mowgli's applyNightAction already made him immutable after choosing
    // once, but the real point of this test is the STEP is simply absent.
    const allStepRoleIds = new Set<string>();
    let guard = 0;
    while (engine.getCurrentNightStepRoleIds() !== null && guard < 10) {
      for (const id of engine.getCurrentNightStepRoleIds()!) allStepRoleIds.add(id);
      engine.forceAdvanceNightStep();
      guard += 1;
    }
    expect(allStepRoleIds.has("MOWGLI")).toBe(false);
  });

  it("early completion advances immediately, without waiting for a timer", () => {
    // Includes a lone wolf, kept alive throughout, purely so the game
    // doesn't instantly declare a "no wolves" VILLAGE victory (see
    // VictoryConditions.villageEliminatesAllWolves) the moment night
    // resolves — same reasoning as alien.test.ts's own rosters.
    const names = ["Chef", "Salvateur", "Wolf", "V3"];
    const { engine, ids, roles } = bootToNight1(5, { SALVATEUR: 1, LOUP_GAROU: 1 }, names);
    const salvateurId = names.map((n) => ids[n]!).find((id) => roles.get(id) === "SALVATEUR")!;
    expect(engine.getCurrentNightStepRoleIds()).toEqual(["SALVATEUR"]);
    engine.submitNightAction(salvateurId, "PROTECT", ids.V3!);
    // Only the Salvateur has actually submitted -> the Werewolves step
    // still remains, so completing HIS step just advances, it doesn't end
    // the whole night by itself (that's covered by the later assertion
    // that we land back on the Werewolves step, not MORNING, yet).
    expect(engine.advanceNightStepIfComplete()).toBe(true);
    expect(engine.getCurrentNightStepRoleIds()).toEqual(["LOUP_GAROU"]);
  });

  it("forceAdvanceNightStep skips a straggler with SKIP and still advances", () => {
    // 4 villagers vs 2 wolves (not 2-vs-2) so that killing one villager
    // doesn't itself trigger a wolves-reach-parity victory (see
    // VictoryConditions.wolvesReachParity) — this test is about the step
    // machinery, not about the resulting win condition.
    const names = ["Chef", "Wolf1", "Wolf2", "V2", "V3", "V4"];
    const { engine, ids, roles } = bootToNight1(6, { LOUP_GAROU: 2 }, names);
    const wolfIds = names.map((n) => ids[n]!).filter((id) => roles.get(id) === "LOUP_GAROU");
    expect(wolfIds).toHaveLength(2);
    // Deliberately not the elected Chef — killing the Chef would open a
    // pending succession blocker (see GameEngine.hasPendingBlockers) and
    // park the night mid-resolution instead of reaching MORNING, which
    // would defeat the point of this specific test.
    const villagerId = names
      .map((n) => ids[n]!)
      .find((id) => !wolfIds.includes(id) && id !== engine.getChefId())!;

    expect(engine.getCurrentNightStepRoleIds()).toEqual(["LOUP_GAROU"]);
    engine.submitNightAction(wolfIds[0]!, "KILL_VOTE", villagerId); // the second wolf never votes

    expect(engine.advanceNightStepIfComplete()).toBe(false); // still incomplete, second wolf owed
    expect(engine.forceAdvanceNightStep()).toBe(true); // timer-expiry style force
    expect(engine.getCurrentNightStepRoleIds()).toBeNull(); // last/only step -> night resolved
    expect(engine.getPhase()).toBe("MORNING");
    // The one real vote still counted -> the target actually died.
    expect(engine.getPublicState().players.find((p) => p.id === villagerId)!.isAlive).toBe(false);
  });

  it("a mid-night death (Alien kill) vacates a later step entirely instead of hanging on a dead player", () => {
    // Two extra plain villagers (on top of the lone wolf) so that BOTH
    // deaths this night (the Alien's guess victim + the wolves' kill
    // victim) still leave village strictly outnumbering wolves afterwards
    // — otherwise VictoryConditions.wolvesReachParity would end the game
    // right here instead of landing on MORNING, which isn't what this
    // test is about.
    const names = ["Chef", "Alien", "Voyante", "Wolf", "V2", "V3"];
    // Seed chosen (via a throwaway seed sweep) so the Voyante and the
    // elected Chef land on different players — see the comment below.
    const { engine, ids, roles } = bootToNight1(9, { ALIEN: 1, VOYANTE: 1, LOUP_GAROU: 1 }, names);
    const alienId = names.map((n) => ids[n]!).find((id) => roles.get(id) === "ALIEN")!;
    const voyanteId = names.map((n) => ids[n]!).find((id) => roles.get(id) === "VOYANTE")!;
    const wolfId = names.map((n) => ids[n]!).find((id) => roles.get(id) === "LOUP_GAROU")!;
    // If the Voyante happened to be the elected Chef, killing her would
    // open a pending succession blocker and park the night in NIGHT
    // instead of reaching MORNING — not what this test is about.
    expect(voyanteId).not.toBe(engine.getChefId());
    // ALIEN (priority 15) comes before VOYANTE (priority 20) in this roster.
    expect(engine.getCurrentNightStepRoleIds()).toEqual(["ALIEN"]);
    engine.submitNightAction(alienId, "ALIEN_GUESS", voyanteId, "VOYANTE" as any); // correct guess -> instant death
    expect(engine.getPublicState().players.find((p) => p.id === voyanteId)!.isAlive).toBe(false);
    // advanceNightStepIfComplete() loops through every consecutively
    // complete step in one call: it closes ALIEN's own step (just
    // submitted) AND, in the same call, skips straight over the Voyante's
    // now-vacated step (she's dead — zero alive holders, vacuously
    // complete) — instead of leaving the night stuck waiting for a prompt
    // nobody can ever answer. It only stops once it reaches an actually
    // incomplete step (the wolves' still-unsubmitted vote), so this single
    // call returns true (something changed) even though the night itself
    // hasn't fully resolved yet.
    expect(engine.advanceNightStepIfComplete()).toBe(true);
    expect(engine.getCurrentNightStepRoleIds()).toEqual(["LOUP_GAROU"]);
    // Target picked dynamically, excluding the wolf himself and the
    // elected Chef (killing the Chef would open a pending succession
    // blocker and park the night at NIGHT instead of MORNING).
    const chefId = engine.getChefId();
    const killTargetId = names.map((n) => ids[n]!).find((id) => id !== wolfId && id !== chefId && id !== voyanteId)!;
    engine.submitNightAction(wolfId, "KILL_VOTE", killTargetId);
    expect(engine.advanceNightStepIfComplete()).toBe(true);
    expect(engine.getCurrentNightStepRoleIds()).toBeNull();
    expect(engine.getPhase()).toBe("MORNING");
  });

  it("Alien mandatory-guess-on-forced-night: a timed-out step auto-resolves at random instead of hanging", () => {
    // Includes a lone wolf, kept alive throughout, purely so the game
    // doesn't instantly declare a "no wolves" VILLAGE victory the moment
    // night resolves.
    const names = ["Chef", "Alien", "Wolf", "V3"];
    const engine = GameEngine.createGame(
      { roleCounts: { ALIEN: 1, LOUP_GAROU: 1 } as any, nightMode: "SEQUENTIAL" },
      seededRng(8),
    );
    const ids: Record<string, string> = {};
    for (const n of names) ids[n] = engine.addPlayer(n).id;
    engine.startGame();
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const alienId = names.map((n) => ids[n]!).find((id) => roles.get(id) === "ALIEN")!;
    const chefName = names.find((n) => ids[n] !== alienId)!;
    engine.volunteerForChef(ids[chefName]!);
    engine.forceStartChefDebate();
    engine.advanceChefSpeaker();
    for (const n of names) if (n !== chefName) engine.castChefVote(ids[n]!, ids[chefName]!);
    engine.tallyChefVoteAndProceed();
    engine.proceedFromChefRevealToDiscussion();

    engine.triggerAlienNightfall(alienId); // -> NIGHT 1, forced

    expect(engine.getCurrentNightStepRoleIds()).toEqual(["ALIEN"]);
    // Nobody ever calls submitNightAction for him -> straight to forced advance.
    expect(() => engine.forceAdvanceNightStep()).not.toThrow();
    // A real guess WAS submitted on his behalf (not a silent no-op skip).
    expect(engine.getAlienLastGuessResult(alienId)).not.toBeNull();
    // forceAdvanceNightStep only forces the CURRENT step closed (see its
    // own doc comment) — the lone wolf's later step (if he's still alive;
    // the Alien's random guess might have killed him) may still be owed,
    // so force through however many steps remain rather than assuming one
    // call reaches MORNING outright.
    while (engine.getCurrentNightStepRoleIds() !== null) {
      engine.forceAdvanceNightStep();
    }
    expect(engine.getCurrentNightStepRoleIds()).toBeNull();
    // Either MORNING (normal case) or ENDED (the Alien's random guess
    // happened to kill the lone wolf too, ending the game outright) are
    // both valid proof the night resolved instead of hanging — this test
    // is about the forced-guess unsticking the step, not the resulting
    // victory condition.
    expect(["MORNING", "ENDED"]).toContain(engine.getPhase());
  });

  it("Loup Vert's guess/steal stays usable at any point in the sequence, regardless of the current step (v1 scope)", () => {
    const { engine, loupVertId, voyanteId } = bootToNight2(9);
    // Whatever the current step happens to be, it is deliberately NOT
    // "LOUP_VERT" (his guess isn't a sequence step in v1 — see
    // NightSequencer.ts's doc comment) — his guess must work regardless.
    const outcome = engine.submitLoupVertGuess(loupVertId, voyanteId, "VOYANTE");
    expect(outcome.correct).toBe(true);
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    expect(roles.get(voyanteId)).toBe("VILLAGEOIS"); // Option A: instant, same-night demotion, unaffected by sequencing
  });

  it("nightStepDisabled removes a role's step entirely, all game", () => {
    const engine = GameEngine.createGame(
      {
        roleCounts: { SALVATEUR: 1, VOYANTE: 1 } as any,
        nightMode: "SEQUENTIAL",
        nightStepDisabled: ["VOYANTE"],
      },
      seededRng(11),
    );
    const names = ["Chef", "Salvateur", "Voyante", "V2"];
    const ids: Record<string, string> = {};
    for (const n of names) ids[n] = engine.addPlayer(n).id;
    engine.startGame();
    engine.volunteerForChef(ids.Chef!);
    engine.forceStartChefDebate();
    engine.advanceChefSpeaker();
    for (const n of names.slice(1)) engine.castChefVote(ids[n]!, ids.Chef!);
    engine.tallyChefVoteAndProceed();
    engine.proceedFromChefRevealToDiscussion();
    engine.endDay1Discussion();

    const seen = new Set<string>();
    while (engine.getCurrentNightStepRoleIds() !== null) {
      for (const id of engine.getCurrentNightStepRoleIds()!) seen.add(id);
      engine.forceAdvanceNightStep();
    }
    expect(seen.has("VOYANTE")).toBe(false);
    expect(seen.has("SALVATEUR")).toBe(true);
  });

  it("nightStepOrder override reorders explicitly-listed roles and appends the rest in default order (pure computeNightSteps)", () => {
    const engine = GameEngine.createGame(
      {
        roleCounts: { SALVATEUR: 1, VOYANTE: 1, SORCIERE: 1 } as any,
        nightMode: "SEQUENTIAL",
        nightStepOrder: ["SORCIERE", "SALVATEUR"], // VOYANTE unmentioned
      },
      seededRng(12),
    );
    const names = ["Chef", "Salvateur", "Voyante", "Sorciere", "V2"];
    const ids: Record<string, string> = {};
    for (const n of names) ids[n] = engine.addPlayer(n).id;
    engine.startGame();
    engine.volunteerForChef(ids.Chef!);
    engine.forceStartChefDebate();
    engine.advanceChefSpeaker();
    for (const n of names.slice(1)) engine.castChefVote(ids[n]!, ids.Chef!);
    engine.tallyChefVoteAndProceed();
    engine.proceedFromChefRevealToDiscussion();
    engine.endDay1Discussion();

    const order: string[] = [];
    while (engine.getCurrentNightStepRoleIds() !== null) {
      order.push(...engine.getCurrentNightStepRoleIds()!);
      engine.forceAdvanceNightStep();
    }
    // SORCIERE explicitly first, SALVATEUR explicitly second, VOYANTE
    // (unmentioned) appended after, per computeNightSteps' documented
    // "stable, unmentioned-roles-keep-default-order-at-the-end" semantics.
    expect(order).toEqual(["SORCIERE", "SALVATEUR", "VOYANTE"]);
  });

  it("SIMULTANEOUS mode (the default) is completely unaffected: no sequential state, all prompts at once", () => {
    const names = ["Chef", "Salvateur", "Voyante", "V2"];
    const engine = GameEngine.createGame(
      { roleCounts: { SALVATEUR: 1, VOYANTE: 1 } as any }, // nightMode omitted -> "SIMULTANEOUS"
      seededRng(13),
    );
    const ids: Record<string, string> = {};
    for (const n of names) ids[n] = engine.addPlayer(n).id;
    engine.startGame();
    engine.volunteerForChef(ids.Chef!);
    engine.forceStartChefDebate();
    engine.advanceChefSpeaker();
    for (const n of names.slice(1)) engine.castChefVote(ids[n]!, ids.Chef!);
    engine.tallyChefVoteAndProceed();
    engine.proceedFromChefRevealToDiscussion();
    engine.endDay1Discussion();

    expect(engine.isSequentialNightMode()).toBe(false);
    expect(engine.getCurrentNightStepRoleIds()).toBeNull();
    expect(engine.getNightStepProgress()).toEqual({ stepIndex: 0, totalSteps: 0 });
    expect(engine.advanceNightStepIfComplete()).toBe(false);
    expect(engine.forceAdvanceNightStep()).toBe(false);
    // Both active roles prompted simultaneously, exactly as before this feature existed.
    expect(engine.getNightPrompts().map((p) => p.player.roleId).sort()).toEqual(["SALVATEUR", "VOYANTE"]);
  });
});
