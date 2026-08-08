import { describe, expect, it } from "vitest";
import { BADGE_REGISTRY, evaluateBadges, type BadgeContext } from "./deriveBadges.js";

function ctx(overrides: Partial<BadgeContext> = {}): BadgeContext {
  return {
    gamesPlayed: 0,
    longestWinStreak: 0,
    level: 1,
    mvpCount: 0,
    soleSurvivorCount: 0,
    voyanteWolvesFound: 0,
    salvateurSuccessfulProtects: 0,
    sorciereWolvesKilledByPoison: 0,
    chasseurWolvesKilledByShot: 0,
    alienCorrectGuesses: 0,
    loupVertSuccessfulSteals: 0,
    corbeauSuccessfulMarks: 0,
    barbieWolvesRevealed: 0,
    barbieMisfireCount: 0,
    mowgliTransformCount: 0,
    ...overrides,
  };
}

describe("BADGE_REGISTRY", () => {
  it("has no duplicate ids", () => {
    const ids = BADGE_REGISTRY.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every badge has a non-empty name and description", () => {
    for (const b of BADGE_REGISTRY) {
      expect(b.name.length).toBeGreaterThan(0);
      expect(b.description.length).toBeGreaterThan(0);
    }
  });
});

describe("evaluateBadges", () => {
  it("unlocks nothing for a completely fresh account", () => {
    expect(evaluateBadges(ctx())).toEqual([]);
  });

  it("unlocks FIRST_GAME after exactly one game", () => {
    expect(evaluateBadges(ctx({ gamesPlayed: 1 }))).toContain("FIRST_GAME");
  });

  it("unlocks VETERAN/CENTURION at the right thresholds, without re-unlocking FIRST_GAME redundantly", () => {
    const at50 = evaluateBadges(ctx({ gamesPlayed: 50 }));
    expect(at50).toContain("FIRST_GAME");
    expect(at50).toContain("VETERAN");
    expect(at50).not.toContain("CENTURION");

    const at100 = evaluateBadges(ctx({ gamesPlayed: 100 }));
    expect(at100).toContain("CENTURION");
  });

  it("HOT_STREAK/UNSTOPPABLE key off the longest streak ever, not gamesPlayed", () => {
    expect(evaluateBadges(ctx({ longestWinStreak: 2 }))).not.toContain("HOT_STREAK");
    expect(evaluateBadges(ctx({ longestWinStreak: 3 }))).toContain("HOT_STREAK");
    expect(evaluateBadges(ctx({ longestWinStreak: 5 }))).toContain("UNSTOPPABLE");
  });

  it("LAST_STANDING unlocks from a single sole-survivor game", () => {
    expect(evaluateBadges(ctx({ soleSurvivorCount: 1 }))).toContain("LAST_STANDING");
  });

  it("role-mastery badges unlock exactly at their documented thresholds", () => {
    expect(evaluateBadges(ctx({ voyanteWolvesFound: 9 }))).not.toContain("EAGLE_EYE");
    expect(evaluateBadges(ctx({ voyanteWolvesFound: 10 }))).toContain("EAGLE_EYE");
    expect(evaluateBadges(ctx({ salvateurSuccessfulProtects: 10 }))).toContain("GUARDIAN_ANGEL");
    expect(evaluateBadges(ctx({ sorciereWolvesKilledByPoison: 5 }))).toContain("CHEMIST");
    expect(evaluateBadges(ctx({ chasseurWolvesKilledByShot: 5 }))).toContain("SHARPSHOOTER");
    expect(evaluateBadges(ctx({ alienCorrectGuesses: 10 }))).toContain("TELEPATH");
    expect(evaluateBadges(ctx({ loupVertSuccessfulSteals: 5 }))).toContain("INFILTRATOR");
    expect(evaluateBadges(ctx({ corbeauSuccessfulMarks: 5 }))).toContain("CUNNING_CROW");
    expect(evaluateBadges(ctx({ barbieWolvesRevealed: 3 }))).toContain("ACTRESS");
  });

  it("POPULAR and LEVELING_UP read straight from mvpCount/level", () => {
    expect(evaluateBadges(ctx({ mvpCount: 5 }))).toContain("POPULAR");
    expect(evaluateBadges(ctx({ level: 10 }))).toContain("LEVELING_UP");
  });

  it("secret badges unlock the same way as any other, just flagged `secret: true` in the registry", () => {
    expect(evaluateBadges(ctx({ barbieMisfireCount: 1 }))).toContain("MISFIRE");
    expect(evaluateBadges(ctx({ mowgliTransformCount: 1 }))).toContain("IMAGINARY_FRIEND");
    expect(BADGE_REGISTRY.find((b) => b.id === "MISFIRE")?.secret).toBe(true);
    expect(BADGE_REGISTRY.find((b) => b.id === "IMAGINARY_FRIEND")?.secret).toBe(true);
  });

  it("a maxed-out context unlocks every single badge in the registry", () => {
    const maxed = ctx({
      gamesPlayed: 100,
      longestWinStreak: 5,
      level: 10,
      mvpCount: 5,
      soleSurvivorCount: 1,
      voyanteWolvesFound: 10,
      salvateurSuccessfulProtects: 10,
      sorciereWolvesKilledByPoison: 5,
      chasseurWolvesKilledByShot: 5,
      alienCorrectGuesses: 10,
      loupVertSuccessfulSteals: 5,
      corbeauSuccessfulMarks: 5,
      barbieWolvesRevealed: 3,
      barbieMisfireCount: 1,
      mowgliTransformCount: 1,
    });
    expect(evaluateBadges(maxed).sort()).toEqual(BADGE_REGISTRY.map((b) => b.id).sort());
  });
});
