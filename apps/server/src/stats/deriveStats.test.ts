import { describe, expect, it } from "vitest";
import {
  computeDeathBreakdown,
  computePerRoleStats,
  computeWinStreaks,
  averageNightsSurvived,
  nightsSurvived,
} from "./deriveStats.js";

describe("computePerRoleStats", () => {
  it("groups generically by whatever roleId strings appear, unsorted role set", () => {
    const stats = computePerRoleStats([
      { roleId: "VOYANTE", result: "WON" },
      { roleId: "VOYANTE", result: "LOST" },
      { roleId: "LOUP_GAROU", result: "WON" },
      { roleId: "UN_ROLE_FUTUR_INEDIT", result: "WON" },
    ]);
    const byRole = Object.fromEntries(stats.map((s) => [s.roleId, s]));
    expect(byRole.VOYANTE).toEqual({ roleId: "VOYANTE", games: 2, wins: 1, losses: 1, winRate: 0.5 });
    expect(byRole.LOUP_GAROU).toEqual({ roleId: "LOUP_GAROU", games: 1, wins: 1, losses: 0, winRate: 1 });
    // A role the test has never seen before still gets a correct bucket —
    // this is what "fonctionne automatiquement" (spec section 16) means in practice.
    expect(byRole.UN_ROLE_FUTUR_INEDIT).toEqual({
      roleId: "UN_ROLE_FUTUR_INEDIT",
      games: 1,
      wins: 1,
      losses: 0,
      winRate: 1,
    });
  });

  it("returns an empty array for no games", () => {
    expect(computePerRoleStats([])).toEqual([]);
  });
});

describe("computeWinStreaks", () => {
  it("computes both current and longest streaks, in chronological order regardless of input order", () => {
    // Shuffled on purpose — the function must sort by playedAt itself.
    const records = [
      { result: "LOST" as const, playedAt: 5 },
      { result: "WON" as const, playedAt: 1 },
      { result: "WON" as const, playedAt: 2 },
      { result: "WON" as const, playedAt: 3 },
      { result: "LOST" as const, playedAt: 4 },
      { result: "WON" as const, playedAt: 6 },
    ];
    // Chronological: WON, WON, WON, LOST, LOST, WON
    expect(computeWinStreaks(records)).toEqual({ current: 1, longest: 3 });
  });

  it("current streak is 0 if the most recent game was a loss or draw", () => {
    const records = [
      { result: "WON" as const, playedAt: 1 },
      { result: "WON" as const, playedAt: 2 },
      { result: "DRAW" as const, playedAt: 3 },
    ];
    expect(computeWinStreaks(records)).toEqual({ current: 0, longest: 2 });
  });

  it("handles an empty history", () => {
    expect(computeWinStreaks([])).toEqual({ current: 0, longest: 0 });
  });
});

describe("nightsSurvived / averageNightsSurvived", () => {
  it("credits a survivor with the game's full night count", () => {
    expect(nightsSurvived({ isAlive: true, deathMoment: null, finalNightNumber: 4 })).toBe(4);
  });

  it("dying during Nuit N means N-1 full nights survived", () => {
    expect(nightsSurvived({ isAlive: false, deathMoment: "Nuit 3", finalNightNumber: 5 })).toBe(2);
  });

  it("dying during Jour N means N full nights survived", () => {
    expect(nightsSurvived({ isAlive: false, deathMoment: "Jour 2", finalNightNumber: 5 })).toBe(2);
  });

  it("falls back to 0 for an unparseable/missing deathMoment on a dead player", () => {
    expect(nightsSurvived({ isAlive: false, deathMoment: null, finalNightNumber: 5 })).toBe(0);
  });

  it("averages across several games", () => {
    const avg = averageNightsSurvived([
      { isAlive: true, deathMoment: null, finalNightNumber: 4 }, // 4
      { isAlive: false, deathMoment: "Nuit 1", finalNightNumber: 6 }, // 0
    ]);
    expect(avg).toBe(2);
  });

  it("returns 0 for no games", () => {
    expect(averageNightsSurvived([])).toBe(0);
  });
});

describe("computeDeathBreakdown", () => {
  it("counts each category independently and generically", () => {
    const breakdown = computeDeathBreakdown([
      { deathMoment: "Nuit 1", deathCause: "LOUP_GAROU_ATTACK", isAlive: false },
      { deathMoment: "Nuit 2", deathCause: "LOUP_BLANC_ATTACK", isAlive: false },
      { deathMoment: "Jour 3", deathCause: "VOTE_ELIMINATION", isAlive: false },
      { deathMoment: null, deathCause: null, isAlive: true },
      { deathMoment: "Nuit 1", deathCause: "SORCIERE_POISON", isAlive: false },
    ]);
    expect(breakdown).toEqual({
      firstNightDeaths: 2, // both "Nuit 1" deaths, regardless of cause
      killedByWolves: 2, // LOUP_GAROU_ATTACK + LOUP_BLANC_ATTACK only
      executedByVillage: 1,
      survivedUntilEnd: 1,
    });
  });

  it("returns all zeros for no games", () => {
    expect(computeDeathBreakdown([])).toEqual({
      firstNightDeaths: 0,
      killedByWolves: 0,
      executedByVillage: 0,
      survivedUntilEnd: 0,
    });
  });
});
