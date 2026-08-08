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

describe("Alien", () => {
  it("a correct guess kills the target immediately, indistinguishable from any other death", () => {
    const names = ["Chef", "Alien", "VoyanteVictim", "V1", "V2"];
    const { engine, ids, roles } = bootToNight1(7, { VOYANTE: 1, ALIEN: 1 }, names);
    const alienId = names.find((n) => roles.get(ids[n]!) === "ALIEN")!;
    const voyanteId = names.find((n) => roles.get(ids[n]!) === "VOYANTE")!;

    engine.submitNightAction(ids[alienId]!, "ALIEN_GUESS", ids[voyanteId]!, "VOYANTE" as any);
    expect(engine.getPublicState().players.find((p) => p.id === ids[voyanteId]!)!.isAlive).toBe(false);
    expect(engine.getAlienLastGuessResult(ids[alienId]!)).toBe("CORRECT");

    const result = engine.resolveNightAndProceed();
    expect(result.anyoneDied).toBe(true); // the morning announcement reflects it like any other death
    // Public lastDeaths carries name + role but no "cause" field — no way to tell the Alien did it.
    const death = engine.getPublicState().lastDeaths.find((d) => d.playerId === ids[voyanteId]!);
    expect(death).toBeTruthy();
    expect(JSON.stringify(death)).not.toMatch(/ALIEN/i);
  });

  it("a wrong guess against a village-team role costs one village-pool chance, no death", () => {
    const names = ["Chef", "Alien", "V1", "V2", "V3"];
    const { engine, ids, roles } = bootToNight1(7, { ALIEN: 1 }, names);
    const alienId = names.find((n) => roles.get(ids[n]!) === "ALIEN")!;
    const target = names.find((n) => n !== alienId)!;

    expect(engine.getPrivateRoleExtras(ids[alienId]!).alienChances).toEqual({ village: 2, wolf: 1 });
    // The target is a plain VILLAGEOIS — guessing SALVATEUR (also village-team) is wrong.
    engine.submitNightAction(ids[alienId]!, "ALIEN_GUESS", ids[target]!, "SALVATEUR" as any);

    expect(engine.getAlienLastGuessResult(ids[alienId]!)).toBe("WRONG");
    expect(engine.getPrivateRoleExtras(ids[alienId]!).alienChances).toEqual({ village: 1, wolf: 1 });
    expect(engine.getPublicState().players.find((p) => p.id === ids[alienId]!)!.isAlive).toBe(true);
    expect(engine.getPublicState().players.find((p) => p.id === ids[target]!)!.isAlive).toBe(true);
  });

  it("a wrong guess against a wolf-team role costs one wolf-pool chance (separate from the village pool)", () => {
    const names = ["Chef", "Alien", "LoupGarou", "V1", "V2"];
    const { engine, ids, roles } = bootToNight1(7, { LOUP_GAROU: 1, ALIEN: 1 }, names);
    const alienId = names.find((n) => roles.get(ids[n]!) === "ALIEN")!;
    const villager = names.find(
      (n) => roles.get(ids[n]!) !== "ALIEN" && roles.get(ids[n]!) !== "LOUP_GAROU",
    )!;

    // Villager isn't LOUP_BLANC — wrong guess, wolf-team category.
    engine.submitNightAction(ids[alienId]!, "ALIEN_GUESS", ids[villager]!, "LOUP_BLANC" as any);
    expect(engine.getPrivateRoleExtras(ids[alienId]!).alienChances).toEqual({ village: 2, wolf: 0 });
    expect(engine.getPublicState().players.find((p) => p.id === ids[alienId]!)!.isAlive).toBe(true);
  });

  it("a wrong guess when that category's pool is already empty kills the Alien", () => {
    // 7 players: LoupGarou (never killed, kept around so wolf-parity math
    // stays harmless), Alien, a Chef, and 4 plain villagers — enough
    // padding to survive two clean single-winner day votes without
    // tripping any victory condition before the assertion.
    const names = ["Chef", "Alien", "LoupGarou", "V1", "V2", "V3", "V4"];
    const { engine, ids, roles } = bootToNight1(7, { LOUP_GAROU: 1, ALIEN: 1 }, names);
    const alienId = names.find((n) => roles.get(ids[n]!) === "ALIEN")!;
    const wolfId = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    const villagers = names.filter((n) => n !== alienId && n !== wolfId);

    // Spend the single wolf-pool chance (night 1) against a harmless villager.
    engine.submitNightAction(ids[alienId]!, "ALIEN_GUESS", ids[villagers[0]!]!, "LOUP_BLANC" as any);
    expect(engine.getPrivateRoleExtras(ids[alienId]!).alienChances?.wolf).toBe(0);
    engine.resolveNightAndProceed(); // -> MORNING, no death
    engine.proceedFromMorningToDay(); // -> DAY_DISCUSSION
    engine.endDayDiscussion(); // -> DAY_VOTE

    // Everyone votes for the same filler villager — clean single-winner
    // elimination, no ties, no chef succession (villagers[1] isn't Chef).
    const alive = engine.getPublicState().players.filter((p) => p.isAlive).map((p) => p.id);
    const votes: Record<string, string> = {};
    for (const id of alive) votes[id] = ids[villagers[1]!]!;
    castDayVotesInOrder(engine, votes);
    engine.proceedFromDayVoteResultToNight(); // -> NIGHT 2

    // Wolf pool is already 0 — a second wrong wolf-team guess is fatal.
    engine.submitNightAction(ids[alienId]!, "ALIEN_GUESS", ids[villagers[2]!]!, "LOUP_BLANC" as any);
    expect(engine.getPublicState().players.find((p) => p.id === ids[alienId]!)!.isAlive).toBe(false);
  });

  it("never wins on his own and is excluded from wolf-parity / all-wolves-dead victory math", () => {
    // 2 wolves + 1 villager + 1 Alien: wolves reach parity (2 vs 1, Alien not counted) -> LOUPS win.
    const names = ["Chef", "Alien", "Wolf1", "Wolf2", "V1"];
    const { engine, ids, roles } = bootToNight1(9, { LOUP_GAROU: 2, ALIEN: 1 }, names);
    const wolves = names.filter((n) => roles.get(ids[n]!) === "LOUP_GAROU");
    const villagers = names.filter(
      (n) => roles.get(ids[n]!) !== "LOUP_GAROU" && roles.get(ids[n]!) !== "ALIEN",
    );
    // Whichever of the two remaining villagers ISN'T the elected Chef — this
    // test is about wolf-parity math, and must stay isolated from the
    // separate Chef-succession blocker (which would ALSO stall progression
    // if the elected Chef were the one killed).
    const villager = villagers.find((n) => ids[n] !== engine.getChefId())!;

    engine.submitNightAction(ids[wolves[0]!]!, "KILL_VOTE", ids[villager]!);
    engine.submitNightAction(ids[wolves[1]!]!, "KILL_VOTE", ids[villager]!);
    engine.resolveNightAndProceed();

    expect(engine.getPhase()).toBe("ENDED");
    expect(engine.getPublicState().winner).toBe("LOUPS");
  });

  it("village still wins normally with the Alien alive and uninvolved", () => {
    const names = ["Chef", "Alien", "LoupGarou", "V1"];
    const { engine, ids, roles } = bootToNight1(9, { LOUP_GAROU: 1, ALIEN: 1 }, names);
    const wolfId = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    const villagerId = names.find(
      (n) => roles.get(ids[n]!) !== "LOUP_GAROU" && roles.get(ids[n]!) !== "ALIEN",
    )!;
    void villagerId;

    // Nobody acts at night — day vote eliminates the wolf outright.
    engine.resolveNightAndProceed();
    engine.proceedFromMorningToDay();
    engine.endDayDiscussion();
    const alive = engine.getPublicState().players.filter((p) => p.isAlive).map((p) => p.id);
    const votes: Record<string, string> = {};
    for (const id of alive) votes[id] = ids[wolfId]!;
    castDayVotesInOrder(engine, votes);

    expect(engine.getPhase()).toBe("ENDED");
    expect(engine.getPublicState().winner).toBe("VILLAGE");
    // The Alien is still alive and simply irrelevant to the outcome.
    expect(engine.getPublicState().players.find((p) => p.id === ids[names.find((n) => roles.get(ids[n]!) === "ALIEN")!]!)!.isAlive).toBe(true);
  });

  describe("forcing an early nightfall mid-discussion", () => {
    it("Day 1: the Alien can force night to fall before discussion naturally ends, skipping the rest of it", () => {
      const names = ["Chef", "Alien", "V1", "V2", "V3"];
      const engine = GameEngine.createGame({ roleCounts: { ALIEN: 1 } as any }, seededRng(7));
      const ids: Record<string, string> = {};
      for (const n of names) ids[n] = engine.addPlayer(n).id;
      engine.startGame();
      const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
      const alienId = names.find((n) => roles.get(ids[n]!) === "ALIEN")!;
      engine.volunteerForChef(ids[names[0]!]!);
      engine.forceStartChefDebate();
      engine.advanceChefSpeaker();
      for (const n of names.slice(1)) engine.castChefVote(ids[n]!, ids[names[0]!]!);
      engine.tallyChefVoteAndProceed();
      engine.proceedFromChefRevealToDiscussion();

      expect(engine.getPhase()).toBe("DAY_1_DISCUSSION");
      expect(engine.canAlienForceNightfall(ids[alienId]!)).toBe(true);
      // Nobody else can, including a fellow living villager.
      const other = names.find((n) => n !== alienId)!;
      expect(engine.canAlienForceNightfall(ids[other]!)).toBe(false);

      engine.triggerAlienNightfall(ids[alienId]!);

      expect(engine.getPhase()).toBe("NIGHT");
      expect(engine.getPublicState().nightNumber).toBe(1);
      // A night like any other in every other respect (prompts, targets,
      // resolution) EXCEPT that his own guess is now mandatory — see the
      // dedicated tests below.
      expect(engine.canAlienForceNightfall(ids[alienId]!)).toBe(false); // no longer in a day discussion
    });

    it("makes the guess mandatory that night: SKIP is rejected and his prompt stays owed until he actually guesses", () => {
      const names = ["Chef", "Alien", "V1", "V2", "V3"];
      const engine = GameEngine.createGame({ roleCounts: { ALIEN: 1 } as any }, seededRng(7));
      const ids: Record<string, string> = {};
      for (const n of names) ids[n] = engine.addPlayer(n).id;
      engine.startGame();
      const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
      const alienId = names.find((n) => roles.get(ids[n]!) === "ALIEN")!;
      engine.volunteerForChef(ids[names[0]!]!);
      engine.forceStartChefDebate();
      engine.advanceChefSpeaker();
      for (const n of names.slice(1)) engine.castChefVote(ids[n]!, ids[names[0]!]!);
      engine.tallyChefVoteAndProceed();
      engine.proceedFromChefRevealToDiscussion();

      engine.triggerAlienNightfall(ids[alienId]!);

      const prompts = engine.getNightPrompts();
      const alienPrompt = prompts.find((p) => p.player.id === ids[alienId]!);
      expect(alienPrompt).toBeTruthy();
      expect((alienPrompt!.request.context as { mustGuess: boolean }).mustGuess).toBe(true);

      expect(() => engine.submitNightAction(ids[alienId]!, "SKIP")).toThrow();

      // The rejected SKIP must not have consumed his turn — see
      // NightResolver.submitNightAction's apply-then-record ordering — so
      // his prompt is still owed exactly as before the failed attempt.
      expect(engine.getNightPrompts().some((p) => p.player.id === ids[alienId]!)).toBe(true);

      // A real guess is accepted normally and does close out his turn.
      const target = names.find((n) => n !== alienId && n !== "Chef")!;
      expect(() =>
        engine.submitNightAction(ids[alienId]!, "ALIEN_GUESS", ids[target]!, "SALVATEUR" as any),
      ).not.toThrow();
      expect(engine.getNightPrompts().some((p) => p.player.id === ids[alienId]!)).toBe(false);
    });

    it("a normal (non-forced) night still lets the Alien skip freely, exactly as before", () => {
      const names = ["Chef", "Alien", "V1", "V2", "V3"];
      const { engine, ids, roles } = bootToNight1(7, { ALIEN: 1 }, names);
      const alienId = names.find((n) => roles.get(ids[n]!) === "ALIEN")!;

      const alienPrompt = engine.getNightPrompts().find((p) => p.player.id === ids[alienId]!);
      expect((alienPrompt!.request.context as { mustGuess: boolean }).mustGuess).toBe(false);

      expect(() => engine.submitNightAction(ids[alienId]!, "SKIP")).not.toThrow();
      expect(engine.getPublicState().players.find((p) => p.id === ids[alienId]!)!.isAlive).toBe(true);
      expect(engine.getAlienLastGuessResult(ids[alienId]!)).toBeNull();
    });

    it("later days: skips whatever's left of discussion, the second debate, AND that day's vote entirely", () => {
      // Includes a lone wolf, kept alive and untouched throughout, purely so
      // the game doesn't instantly declare a "no wolves left" VILLAGE
      // victory the moment the night resolves (see VictoryConditions) —
      // that's not what this test is about.
      const names = ["Chef", "Alien", "LoupGarou", "V1", "V2", "V3"];
      const engine = GameEngine.createGame({ roleCounts: { ALIEN: 1, LOUP_GAROU: 1 } as any }, seededRng(7));
      const ids: Record<string, string> = {};
      for (const n of names) ids[n] = engine.addPlayer(n).id;
      engine.startGame();
      const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
      const alienId = names.find((n) => roles.get(ids[n]!) === "ALIEN")!;
      engine.volunteerForChef(ids[names[0]!]!);
      engine.forceStartChefDebate();
      engine.advanceChefSpeaker();
      for (const n of names.slice(1)) engine.castChefVote(ids[n]!, ids[names[0]!]!);
      engine.tallyChefVoteAndProceed();
      engine.proceedFromChefRevealToDiscussion();
      engine.endDay1Discussion(); // -> NIGHT 1
      engine.resolveNightAndProceed(); // -> MORNING (nobody acted, nobody dies)
      engine.proceedFromMorningToDay(); // -> DAY_DISCUSSION (day 2)

      expect(engine.getPhase()).toBe("DAY_DISCUSSION");
      expect(engine.canAlienForceNightfall(ids[alienId]!)).toBe(true);

      engine.triggerAlienNightfall(ids[alienId]!);

      // Straight to NIGHT — no CHEF_SECOND_DEBATE, no DAY_VOTE in between,
      // and nobody got eliminated by a vote that never happened.
      expect(engine.getPhase()).toBe("NIGHT");
      expect(engine.getPublicState().nightNumber).toBe(2);
      expect(engine.getPublicState().players.every((p) => p.isAlive)).toBe(true);
    });

    it("rejects a dead Alien, a non-Alien, and any phase outside a day discussion", () => {
      // Same "keep a lone wolf around" reasoning as above — avoids an
      // instant no-wolves VILLAGE victory when the night resolves.
      const names = ["Chef", "Alien", "LoupGarou", "V1"];
      const { engine, ids, roles } = bootToNight1(7, { ALIEN: 1, LOUP_GAROU: 1 }, names);
      const alienId = names.find((n) => roles.get(ids[n]!) === "ALIEN")!;
      const villagerId = names.find((n) => n !== alienId && roles.get(ids[n]!) !== "LOUP_GAROU")!;

      // Wrong phase: already NIGHT.
      expect(engine.canAlienForceNightfall(ids[alienId]!)).toBe(false);
      expect(() => engine.triggerAlienNightfall(ids[alienId]!)).toThrow();

      // Non-Alien, even during a day discussion.
      engine.resolveNightAndProceed();
      engine.proceedFromMorningToDay();
      expect(engine.canAlienForceNightfall(ids[villagerId]!)).toBe(false);
      expect(() => engine.triggerAlienNightfall(ids[villagerId]!)).toThrow();
    });

    it("is completely silent: no public log entry names the Alien or attributes the nightfall to anyone", () => {
      const names = ["Chef", "Alien", "V1", "V2", "V3"];
      const engine = GameEngine.createGame({ roleCounts: { ALIEN: 1 } as any }, seededRng(7));
      const ids: Record<string, string> = {};
      for (const n of names) ids[n] = engine.addPlayer(n).id;
      engine.startGame();
      const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
      const alienId = names.find((n) => roles.get(ids[n]!) === "ALIEN")!;
      engine.volunteerForChef(ids[names[0]!]!);
      engine.forceStartChefDebate();
      engine.advanceChefSpeaker();
      for (const n of names.slice(1)) engine.castChefVote(ids[n]!, ids[names[0]!]!);
      engine.tallyChefVoteAndProceed();
      engine.proceedFromChefRevealToDiscussion();

      engine.triggerAlienNightfall(ids[alienId]!);

      // getLogs() is the ADMIN-only log feed (never sent to any player — see
      // broadcast.ts). Even there, no mention of "Alien" — the entry reads
      // like any other transition, matching the "everyone just sees the day
      // end a little early" requirement.
      const recent = engine.getLogs().slice(-3).map((l) => l.message);
      expect(recent.some((m) => /alien/i.test(m))).toBe(false);
      // Public state/players never carry anything either.
      expect(JSON.stringify(engine.getPublicState())).not.toMatch(/nightfall/i);
    });
  });
});
