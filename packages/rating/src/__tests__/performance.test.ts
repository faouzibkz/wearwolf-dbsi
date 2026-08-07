import { afterEach, describe, expect, it } from "vitest";
import type { FinalPlayerSummary } from "@loupgarou/shared";
import { computePerformanceScore, genericPerformanceScore, PERFORMANCE_SCORERS } from "../performance";

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

describe("genericPerformanceScore", () => {
  it("scores a surviving winner near the top", () => {
    const score = genericPerformanceScore({
      summary: summary({ isAlive: true }),
      nightsSurvived: 5,
      totalNights: 5,
      won: true,
    });
    expect(score).toBe(100);
  });

  it("scores a first-night death on the losing team near the bottom", () => {
    const score = genericPerformanceScore({
      summary: summary({ isAlive: false }),
      nightsSurvived: 0,
      totalNights: 5,
      won: false,
    });
    expect(score).toBe(0);
  });

  it("a partial survivor who still won scores between the two extremes", () => {
    const score = genericPerformanceScore({
      summary: summary({ isAlive: false }),
      nightsSurvived: 2,
      totalNights: 5,
      won: true,
    });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(100);
  });

  it("weighs survival more heavily than outcome for SOLO-team roles", () => {
    const soloSurvivorLoss = genericPerformanceScore({
      summary: summary({ team: "SOLO", isAlive: true }),
      nightsSurvived: 5,
      totalNights: 5,
      won: false,
    });
    const villageSurvivorLoss = genericPerformanceScore({
      summary: summary({ team: "VILLAGE", isAlive: true }),
      nightsSurvived: 5,
      totalNights: 5,
      won: false,
    });
    // Full survival should count for more, proportionally, for a SOLO role
    // that lost than for a VILLAGE role that lost, since a SOLO role's loss
    // is far more often just "the game resolved between the other two
    // teams" rather than a reflection of how well they played.
    expect(soloSurvivorLoss).toBeGreaterThan(villageSurvivorLoss);
  });

  it("clamps to [0, 100]", () => {
    const score = genericPerformanceScore({
      summary: summary({ isAlive: true }),
      nightsSurvived: 999,
      totalNights: 5,
      won: true,
    });
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe("computePerformanceScore / PERFORMANCE_SCORERS registry", () => {
  afterEach(() => {
    delete PERFORMANCE_SCORERS.VOYANTE;
  });

  it("falls back to the generic scorer when no role-specific one is registered", () => {
    const ctx = { summary: summary({ roleId: "VOYANTE" }), nightsSurvived: 3, totalNights: 5, won: true };
    expect(computePerformanceScore(ctx)).toBe(genericPerformanceScore(ctx));
  });

  it("uses a registered role-specific scorer instead of the generic one when present", () => {
    // Demonstrates the extension point section 8 asks for ("un calcul
    // personnalisé pour chaque rôle") without needing a real event log to
    // prove the mechanism works: register a throwaway formula for one
    // existing role and confirm it's the one that gets picked up.
    PERFORMANCE_SCORERS.VOYANTE = () => 42;
    const ctx = { summary: summary({ roleId: "VOYANTE" }), nightsSurvived: 3, totalNights: 5, won: true };
    expect(computePerformanceScore(ctx)).toBe(42);
  });
});
