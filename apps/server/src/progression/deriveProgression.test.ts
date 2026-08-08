import { describe, expect, it } from "vitest";
import { computeBaseGameXp, computeLevel, computeMvpBonusXp, XP_MVP, XP_PARTICIPATION, XP_VICTORY } from "./deriveProgression.js";

describe("computeBaseGameXp", () => {
  it("awards participation XP alone for a loss", () => {
    expect(computeBaseGameXp(false)).toBe(XP_PARTICIPATION);
  });

  it("awards participation + victory XP for a win", () => {
    expect(computeBaseGameXp(true)).toBe(XP_PARTICIPATION + XP_VICTORY);
  });
});

describe("computeMvpBonusXp", () => {
  it("returns the spec's MVP bonus value", () => {
    expect(computeMvpBonusXp()).toBe(XP_MVP);
  });
});

describe("computeLevel", () => {
  it("starts at level 1 with 0 XP", () => {
    expect(computeLevel(0)).toBe(1);
  });

  it("stays level 1 all the way up to 99 XP", () => {
    expect(computeLevel(99)).toBe(1);
  });

  it("reaches level 2 at exactly 100 XP", () => {
    expect(computeLevel(100)).toBe(2);
  });

  it("reaches level 3 at 250 XP", () => {
    expect(computeLevel(250)).toBe(3);
  });

  it("never drops below level 1 for negative input", () => {
    expect(computeLevel(-50)).toBe(1);
  });
});
