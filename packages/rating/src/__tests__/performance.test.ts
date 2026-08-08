import { afterEach, describe, expect, it } from "vitest";
import type { FinalPlayerSummary, GameEvent } from "@loupgarou/shared";
import {
  alienPerformanceScore,
  barbiePerformanceScore,
  chasseurPerformanceScore,
  computePerformanceScore,
  corbeauPerformanceScore,
  genericPerformanceScore,
  loupVertPerformanceScore,
  PERFORMANCE_SCORERS,
  type PerformanceContext,
  salvateurPerformanceScore,
  sorcierePerformanceScore,
  voyantePerformanceScore,
  wolfPackPerformanceScore,
} from "../performance";

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

/** Base context for the per-role tests below — override only what each test cares about. */
function ctx(overrides: Partial<PerformanceContext> = {}): PerformanceContext {
  return {
    summary: summary(),
    nightsSurvived: 3,
    totalNights: 5,
    won: true,
    events: [],
    fullEventLog: [],
    ...overrides,
  };
}

describe("genericPerformanceScore", () => {
  it("scores a surviving winner near the top", () => {
    const score = genericPerformanceScore(
      ctx({ summary: summary({ isAlive: true }), nightsSurvived: 5, totalNights: 5, won: true }),
    );
    expect(score).toBe(100);
  });

  it("scores a first-night death on the losing team near the bottom", () => {
    const score = genericPerformanceScore(
      ctx({ summary: summary({ isAlive: false }), nightsSurvived: 0, totalNights: 5, won: false }),
    );
    expect(score).toBe(0);
  });

  it("a partial survivor who still won scores between the two extremes", () => {
    const score = genericPerformanceScore(
      ctx({ summary: summary({ isAlive: false }), nightsSurvived: 2, totalNights: 5, won: true }),
    );
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(100);
  });

  it("weighs survival more heavily than outcome for SOLO-team roles", () => {
    const soloSurvivorLoss = genericPerformanceScore(
      ctx({ summary: summary({ team: "SOLO", isAlive: true }), nightsSurvived: 5, totalNights: 5, won: false }),
    );
    const villageSurvivorLoss = genericPerformanceScore(
      ctx({ summary: summary({ team: "VILLAGE", isAlive: true }), nightsSurvived: 5, totalNights: 5, won: false }),
    );
    // Full survival should count for more, proportionally, for a SOLO role
    // that lost than for a VILLAGE role that lost, since a SOLO role's loss
    // is far more often just "the game resolved between the other two
    // teams" rather than a reflection of how well they played.
    expect(soloSurvivorLoss).toBeGreaterThan(villageSurvivorLoss);
  });

  it("clamps to [0, 100]", () => {
    const score = genericPerformanceScore(
      ctx({ summary: summary({ isAlive: true }), nightsSurvived: 999, totalNights: 5, won: true }),
    );
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe("computePerformanceScore / PERFORMANCE_SCORERS registry", () => {
  afterEach(() => {
    // MOWGLI genuinely has no formula registered (see performance.ts's doc
    // comment on PERFORMANCE_SCORERS) — safe to delete after each test
    // without ever masking a real one for a later test.
    delete PERFORMANCE_SCORERS.MOWGLI;
  });

  it("falls back to the generic scorer when no role-specific one is registered", () => {
    const context = ctx({ summary: summary({ roleId: "MOWGLI" }) });
    expect(computePerformanceScore(context)).toBe(genericPerformanceScore(context));
  });

  it("uses a registered role-specific scorer instead of the generic one when present", () => {
    // Demonstrates the extension point section 8 asks for ("un calcul
    // personnalisé pour chaque rôle").
    PERFORMANCE_SCORERS.MOWGLI = () => 42;
    const context = ctx({ summary: summary({ roleId: "MOWGLI" }) });
    expect(computePerformanceScore(context)).toBe(42);
  });

  it("every role with a real formula is actually wired into the registry", () => {
    for (const roleId of [
      "VOYANTE",
      "SALVATEUR",
      "SORCIERE",
      "ALIEN",
      "LOUP_GAROU",
      "LOUP_BLANC",
      "LOUP_VERT",
      "CHASSEUR",
      "BARBIE",
      "CORBEAU",
    ] as const) {
      expect(PERFORMANCE_SCORERS[roleId]).toBeDefined();
    }
  });
});

describe("voyantePerformanceScore", () => {
  it("falls back to the generic score with no inspections at all", () => {
    const context = ctx({ summary: summary({ roleId: "VOYANTE" }) });
    expect(voyantePerformanceScore(context)).toBe(genericPerformanceScore(context));
  });

  it("scores higher the more inspections actually found a wolf", () => {
    const inspection = (result: "LOUP" | "NON_LOUP"): GameEvent => ({
      type: "VOYANTE_INSPECT",
      night: 1,
      actorId: "p1",
      targetId: "t",
      targetRoleId: result === "LOUP" ? "LOUP_GAROU" : "VILLAGEOIS",
      result,
    });
    const allWolves = ctx({
      summary: summary({ roleId: "VOYANTE" }),
      events: [inspection("LOUP"), inspection("LOUP")],
    });
    const allVillagers = ctx({
      summary: summary({ roleId: "VOYANTE" }),
      events: [inspection("NON_LOUP"), inspection("NON_LOUP")],
    });
    expect(voyantePerformanceScore(allWolves)).toBeGreaterThan(voyantePerformanceScore(allVillagers));
  });
});

describe("salvateurPerformanceScore", () => {
  it("falls back to generic with no protections", () => {
    const context = ctx({ summary: summary({ roleId: "SALVATEUR" }) });
    expect(salvateurPerformanceScore(context)).toBe(genericPerformanceScore(context));
  });

  it("a protection that saved someone scores higher than one that didn't", () => {
    const saved: GameEvent = { type: "SALVATEUR_PROTECT", night: 1, actorId: "p1", targetId: "t", saved: true };
    const missed: GameEvent = { type: "SALVATEUR_PROTECT", night: 1, actorId: "p1", targetId: "t", saved: false };
    const scoreSaved = salvateurPerformanceScore(ctx({ summary: summary({ roleId: "SALVATEUR" }), events: [saved] }));
    const scoreMissed = salvateurPerformanceScore(ctx({ summary: summary({ roleId: "SALVATEUR" }), events: [missed] }));
    expect(scoreSaved).toBeGreaterThan(scoreMissed);
  });
});

describe("sorcierePerformanceScore", () => {
  it("falls back to generic if neither potion was ever used", () => {
    const context = ctx({ summary: summary({ roleId: "SORCIERE" }) });
    expect(sorcierePerformanceScore(context)).toBe(genericPerformanceScore(context));
  });

  it("a heal (always a save) plus a poison that killed a wolf scores higher than a poison that missed", () => {
    const heal: GameEvent = { type: "SORCIERE_HEAL", night: 1, actorId: "p1", targetId: "t" };
    const poisonWolf: GameEvent = {
      type: "SORCIERE_POISON",
      night: 2,
      actorId: "p1",
      targetId: "w",
      targetRoleId: "LOUP_GAROU",
      killedWolf: true,
    };
    const poisonMiss: GameEvent = {
      type: "SORCIERE_POISON",
      night: 2,
      actorId: "p1",
      targetId: "v",
      targetRoleId: "VILLAGEOIS",
      killedWolf: false,
    };
    const good = sorcierePerformanceScore(
      ctx({ summary: summary({ roleId: "SORCIERE" }), events: [heal, poisonWolf] }),
    );
    const bad = sorcierePerformanceScore(
      ctx({ summary: summary({ roleId: "SORCIERE" }), events: [heal, poisonMiss] }),
    );
    expect(good).toBeGreaterThan(bad);
  });
});

describe("alienPerformanceScore", () => {
  it("falls back to generic with no guesses", () => {
    const context = ctx({ summary: summary({ roleId: "ALIEN", team: "SOLO" }) });
    expect(alienPerformanceScore(context)).toBe(genericPerformanceScore(context));
  });

  it("correct guesses score higher than wrong ones", () => {
    const correct: GameEvent = {
      type: "ALIEN_GUESS",
      night: 1,
      actorId: "p1",
      targetId: "t",
      guessedRoleId: "VOYANTE",
      correct: true,
    };
    const wrong: GameEvent = { ...correct, correct: false };
    const good = alienPerformanceScore(ctx({ summary: summary({ roleId: "ALIEN", team: "SOLO" }), events: [correct] }));
    const bad = alienPerformanceScore(ctx({ summary: summary({ roleId: "ALIEN", team: "SOLO" }), events: [wrong] }));
    expect(good).toBeGreaterThan(bad);
  });
});

describe("wolfPackPerformanceScore (LOUP_GAROU / LOUP_BLANC)", () => {
  it("falls back to generic with no recorded kill attempts at all", () => {
    const context = ctx({ summary: summary({ roleId: "LOUP_GAROU", team: "LOUPS" }) });
    expect(wolfPackPerformanceScore(context)).toBe(genericPerformanceScore(context));
  });

  it("is shared collectively — every wolf reads from the full log, not just their own events", () => {
    const landed: GameEvent = { type: "WOLF_KILL_ATTEMPT", night: 1, targetId: "v1", landed: true };
    const missed: GameEvent = { type: "WOLF_KILL_ATTEMPT", night: 2, targetId: "v2", landed: false };
    const bothLanded = wolfPackPerformanceScore(
      ctx({ summary: summary({ roleId: "LOUP_GAROU", team: "LOUPS" }), events: [], fullEventLog: [landed, landed] }),
    );
    const oneMissed = wolfPackPerformanceScore(
      ctx({ summary: summary({ roleId: "LOUP_GAROU", team: "LOUPS" }), events: [], fullEventLog: [landed, missed] }),
    );
    expect(bothLanded).toBeGreaterThan(oneMissed);
  });
});

describe("loupVertPerformanceScore", () => {
  it("adds a guess-accuracy bonus on top of the shared pack score", () => {
    const landed: GameEvent = { type: "WOLF_KILL_ATTEMPT", night: 1, targetId: "v1", landed: true };
    const correctGuess: GameEvent = {
      type: "LOUP_VERT_GUESS",
      night: 2,
      actorId: "p1",
      targetId: "t",
      guessedRoleId: "VOYANTE",
      correct: true,
    };
    const wrongGuess: GameEvent = { ...correctGuess, correct: false };
    const good = loupVertPerformanceScore(
      ctx({
        summary: summary({ roleId: "LOUP_VERT", team: "LOUPS" }),
        events: [correctGuess],
        fullEventLog: [landed],
      }),
    );
    const bad = loupVertPerformanceScore(
      ctx({
        summary: summary({ roleId: "LOUP_VERT", team: "LOUPS" }),
        events: [wrongGuess],
        fullEventLog: [landed],
      }),
    );
    expect(good).toBeGreaterThan(bad);
  });
});

describe("chasseurPerformanceScore", () => {
  it("falls back to generic if he never fired (died without a pending shot, or simply never had to)", () => {
    const context = ctx({ summary: summary({ roleId: "CHASSEUR" }) });
    expect(chasseurPerformanceScore(context)).toBe(genericPerformanceScore(context));
  });

  it("a shot that lands on a wolf scores higher than one that lands on a villager", () => {
    const wolfShot: GameEvent = { type: "CHASSEUR_SHOT", actorId: "p1", targetId: "w", targetRoleId: "LOUP_GAROU" };
    const villagerShot: GameEvent = { type: "CHASSEUR_SHOT", actorId: "p1", targetId: "v", targetRoleId: "VILLAGEOIS" };
    const good = chasseurPerformanceScore(ctx({ summary: summary({ roleId: "CHASSEUR" }), events: [wolfShot] }));
    const bad = chasseurPerformanceScore(ctx({ summary: summary({ roleId: "CHASSEUR" }), events: [villagerShot] }));
    expect(good).toBeGreaterThan(bad);
  });
});

describe("barbiePerformanceScore", () => {
  it("falls back to generic if her power was never used", () => {
    const context = ctx({ summary: summary({ roleId: "BARBIE" }) });
    expect(barbiePerformanceScore(context)).toBe(genericPerformanceScore(context));
  });

  it("unmasking a real wolf scores higher than a misfire on a non-wolf", () => {
    const goodReveal: GameEvent = {
      type: "BARBIE_REVEAL",
      actorId: "p1",
      targetId: "w",
      targetRoleId: "LOUP_GAROU",
      outcome: "WOLF_DIED_BARBIE_CHEF",
    };
    const misfire: GameEvent = {
      type: "BARBIE_REVEAL",
      actorId: "p1",
      targetId: "v",
      targetRoleId: "VILLAGEOIS",
      outcome: "BOTH_DIED",
    };
    const good = barbiePerformanceScore(ctx({ summary: summary({ roleId: "BARBIE" }), events: [goodReveal] }));
    const bad = barbiePerformanceScore(ctx({ summary: summary({ roleId: "BARBIE" }), events: [misfire] }));
    expect(good).toBeGreaterThan(bad);
  });
});

describe("corbeauPerformanceScore", () => {
  it("falls back to generic if he never marked anyone", () => {
    const context = ctx({ summary: summary({ roleId: "CORBEAU" }) });
    expect(corbeauPerformanceScore(context)).toBe(genericPerformanceScore(context));
  });

  it("a mark that led to the marked player's elimination the next day scores higher than one that didn't", () => {
    const mark: GameEvent = { type: "CORBEAU_MARK", night: 1, actorId: "p1", targetId: "t" };
    const eliminationOfMarked: GameEvent = { type: "DAY_VOTE_ELIMINATION", day: 2, round: 1, targetId: "t" };
    const eliminationOfSomeoneElse: GameEvent = { type: "DAY_VOTE_ELIMINATION", day: 2, round: 1, targetId: "other" };
    const good = corbeauPerformanceScore(
      ctx({ summary: summary({ roleId: "CORBEAU" }), events: [mark], fullEventLog: [mark, eliminationOfMarked] }),
    );
    const bad = corbeauPerformanceScore(
      ctx({ summary: summary({ roleId: "CORBEAU" }), events: [mark], fullEventLog: [mark, eliminationOfSomeoneElse] }),
    );
    expect(good).toBeGreaterThan(bad);
  });
});
