import { describe, expect, it } from "vitest";
import type { FinalPlayerSummary, GameEvent } from "@loupgarou/shared";
import { deriveBadgeContribution, wasSoleSurvivor } from "./deriveBadgeContribution.js";

function summary(overrides: Partial<FinalPlayerSummary> = {}): FinalPlayerSummary {
  return {
    playerId: "p1",
    nickname: "Test",
    roleId: "VILLAGEOIS",
    team: "VILLAGE",
    isAlive: true,
    deathCause: null,
    deathMoment: null,
    ...overrides,
  };
}

describe("deriveBadgeContribution", () => {
  it("returns all zeros/false for a player with no events at all", () => {
    expect(deriveBadgeContribution([], [])).toEqual({
      voyanteWolvesFound: 0,
      salvateurSuccessfulProtects: 0,
      sorciereWolvesKilledByPoison: 0,
      chasseurWolvesKilledByShot: 0,
      alienCorrectGuesses: 0,
      loupVertSuccessfulSteals: 0,
      corbeauSuccessfulMarks: 0,
      barbieWolvesRevealed: 0,
      barbieMisfires: 0,
      mowgliTransformed: false,
    });
  });

  it("counts only inspections that actually found a wolf", () => {
    const events: GameEvent[] = [
      { type: "VOYANTE_INSPECT", night: 1, actorId: "p1", targetId: "a", targetRoleId: "LOUP_GAROU", result: "LOUP" },
      { type: "VOYANTE_INSPECT", night: 2, actorId: "p1", targetId: "b", targetRoleId: "VILLAGEOIS", result: "NON_LOUP" },
    ];
    expect(deriveBadgeContribution(events, []).voyanteWolvesFound).toBe(1);
  });

  it("counts only protections that saved someone", () => {
    const events: GameEvent[] = [
      { type: "SALVATEUR_PROTECT", night: 1, actorId: "p1", targetId: "a", saved: true },
      { type: "SALVATEUR_PROTECT", night: 2, actorId: "p1", targetId: "b", saved: false },
    ];
    expect(deriveBadgeContribution(events, []).salvateurSuccessfulProtects).toBe(1);
  });

  it("counts only poisons that killed a wolf", () => {
    const events: GameEvent[] = [
      { type: "SORCIERE_POISON", night: 1, actorId: "p1", targetId: "w", targetRoleId: "LOUP_GAROU", killedWolf: true },
      { type: "SORCIERE_POISON", night: 2, actorId: "p1", targetId: "v", targetRoleId: "VILLAGEOIS", killedWolf: false },
    ];
    expect(deriveBadgeContribution(events, []).sorciereWolvesKilledByPoison).toBe(1);
  });

  it("counts only Chasseur shots that landed on a wolf-team role", () => {
    const events: GameEvent[] = [
      { type: "CHASSEUR_SHOT", actorId: "p1", targetId: "w", targetRoleId: "LOUP_BLANC" },
      { type: "CHASSEUR_SHOT", actorId: "p1", targetId: "v", targetRoleId: "VILLAGEOIS" },
    ];
    expect(deriveBadgeContribution(events, []).chasseurWolvesKilledByShot).toBe(1);
  });

  it("counts only correct Alien guesses and correct Loup Vert guesses", () => {
    const events: GameEvent[] = [
      { type: "ALIEN_GUESS", night: 1, actorId: "p1", targetId: "a", guessedRoleId: "VOYANTE", correct: true },
      { type: "ALIEN_GUESS", night: 2, actorId: "p1", targetId: "b", guessedRoleId: "CHASSEUR", correct: false },
      { type: "LOUP_VERT_GUESS", night: 2, actorId: "p1", targetId: "c", guessedRoleId: "SORCIERE", correct: true },
    ];
    const c = deriveBadgeContribution(events, []);
    expect(c.alienCorrectGuesses).toBe(1);
    expect(c.loupVertSuccessfulSteals).toBe(1);
  });

  it("splits Barbie reveals into wolves-revealed vs. misfires", () => {
    const events: GameEvent[] = [
      { type: "BARBIE_REVEAL", actorId: "p1", targetId: "w", targetRoleId: "LOUP_GAROU", outcome: "WOLF_DIED_BARBIE_CHEF" },
      { type: "BARBIE_REVEAL", actorId: "p1", targetId: "v", targetRoleId: "VILLAGEOIS", outcome: "BOTH_DIED" },
    ];
    const c = deriveBadgeContribution(events, []);
    expect(c.barbieWolvesRevealed).toBe(1);
    expect(c.barbieMisfires).toBe(1);
  });

  it("flags a Mowgli transformation", () => {
    const events: GameEvent[] = [{ type: "MOWGLI_TRANSFORM", night: 2, actorId: "p1", fatherId: "f" }];
    expect(deriveBadgeContribution(events, []).mowgliTransformed).toBe(true);
  });

  it("a Corbeau mark only counts as successful if the SAME target is eliminated the very next day", () => {
    const mark: GameEvent = { type: "CORBEAU_MARK", night: 1, actorId: "p1", targetId: "t" };
    const rightDayRightTarget: GameEvent = { type: "DAY_VOTE_ELIMINATION", day: 2, round: 1, targetId: "t" };
    const rightDayWrongTarget: GameEvent = { type: "DAY_VOTE_ELIMINATION", day: 2, round: 1, targetId: "other" };
    const wrongDay: GameEvent = { type: "DAY_VOTE_ELIMINATION", day: 3, round: 1, targetId: "t" };

    expect(deriveBadgeContribution([mark], [mark, rightDayRightTarget]).corbeauSuccessfulMarks).toBe(1);
    expect(deriveBadgeContribution([mark], [mark, rightDayWrongTarget]).corbeauSuccessfulMarks).toBe(0);
    expect(deriveBadgeContribution([mark], [mark, wrongDay]).corbeauSuccessfulMarks).toBe(0);
  });
});

describe("wasSoleSurvivor", () => {
  it("true for the only alive member of the winning team", () => {
    const me = summary({ playerId: "p1", team: "VILLAGE", isAlive: true });
    const others = [summary({ playerId: "p2", team: "LOUPS", isAlive: false })];
    expect(wasSoleSurvivor(me, [me, ...others], "VILLAGE")).toBe(true);
  });

  it("false if a teammate also survived", () => {
    const me = summary({ playerId: "p1", team: "VILLAGE", isAlive: true });
    const teammate = summary({ playerId: "p2", team: "VILLAGE", isAlive: true });
    expect(wasSoleSurvivor(me, [me, teammate], "VILLAGE")).toBe(false);
  });

  it("false if this player's team didn't win", () => {
    const me = summary({ playerId: "p1", team: "VILLAGE", isAlive: true });
    expect(wasSoleSurvivor(me, [me], "LOUPS")).toBe(false);
  });

  it("false if this player died", () => {
    const me = summary({ playerId: "p1", team: "VILLAGE", isAlive: false });
    expect(wasSoleSurvivor(me, [me], "VILLAGE")).toBe(false);
  });

  it("false on a draw (no winner)", () => {
    const me = summary({ playerId: "p1", team: "VILLAGE", isAlive: true });
    expect(wasSoleSurvivor(me, [me], null)).toBe(false);
  });
});
