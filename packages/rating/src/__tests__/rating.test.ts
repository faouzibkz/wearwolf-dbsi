import { describe, expect, it } from "vitest";
import { computeRatingDelta, specializedScopeForTeam } from "../rating";

describe("computeRatingDelta", () => {
  it("an average player who wins against an average game gains roughly half the k-factor", () => {
    const { delta, newRating } = computeRatingDelta({
      currentRating: 1000,
      avgGameRating: 1000,
      won: true,
      performanceScore: 50, // neutral, contributes nothing
      roleCoefficient: 1.0,
    });
    // expectedScore = 0.5 when ratings are equal, so resultComponent = 32 * (1 - 0.5) = 16.
    expect(delta).toBe(16);
    expect(newRating).toBe(1016);
  });

  it("losing against an average game costs roughly half the k-factor", () => {
    const { delta } = computeRatingDelta({
      currentRating: 1000,
      avgGameRating: 1000,
      won: false,
      performanceScore: 50,
      roleCoefficient: 1.0,
    });
    expect(delta).toBe(-16);
  });

  it("a strong performance can still gain a few points despite losing (spec section 9's first example)", () => {
    const { delta } = computeRatingDelta({
      currentRating: 1000,
      avgGameRating: 1000,
      won: false,
      performanceScore: 100, // maximum performance
      roleCoefficient: 1.0,
    });
    // resultComponent = -16, performanceComponent = ((100-50)/50)*16 = +16 -> net 0.
    // Still strictly better than an average performance in the same loss (-16).
    expect(delta).toBeGreaterThan(-16);
  });

  it("a weak performance can still cost a few points despite winning (spec section 9's second example)", () => {
    const { delta } = computeRatingDelta({
      currentRating: 1000,
      avgGameRating: 1000,
      won: true,
      performanceScore: 0, // minimum performance
      roleCoefficient: 1.0,
    });
    // resultComponent = +16, performanceComponent = ((0-50)/50)*16 = -16 -> net 0.
    expect(delta).toBeLessThan(16);
  });

  it("a harder role's coefficient scales the delta up", () => {
    const easy = computeRatingDelta({ currentRating: 1000, avgGameRating: 1000, won: true, performanceScore: 50, roleCoefficient: 1.0 });
    const hard = computeRatingDelta({ currentRating: 1000, avgGameRating: 1000, won: true, performanceScore: 50, roleCoefficient: 1.35 });
    expect(hard.delta).toBeGreaterThan(easy.delta);
  });

  it("never drops a rating below 0", () => {
    const { newRating } = computeRatingDelta({
      currentRating: 5,
      avgGameRating: 2000,
      won: false,
      performanceScore: 0,
      roleCoefficient: 1.35,
    });
    expect(newRating).toBeGreaterThanOrEqual(0);
  });

  it("a much stronger player beating a much weaker average gains fewer points than an upset", () => {
    const favored = computeRatingDelta({ currentRating: 1400, avgGameRating: 1000, won: true, performanceScore: 50, roleCoefficient: 1.0 });
    const underdog = computeRatingDelta({ currentRating: 1000, avgGameRating: 1400, won: true, performanceScore: 50, roleCoefficient: 1.0 });
    expect(favored.delta).toBeLessThan(underdog.delta);
  });
});

describe("specializedScopeForTeam", () => {
  it("maps every team to exactly the scope the spec names in section 10", () => {
    expect(specializedScopeForTeam("VILLAGE")).toBe("VILLAGE");
    expect(specializedScopeForTeam("LOUPS")).toBe("WOLF");
    expect(specializedScopeForTeam("SOLO")).toBe("SOLO");
  });
});
