import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_DIFFICULTY, getRoleDifficulty, NEUTRAL_ROLE_DIFFICULTY } from "../roleDifficulty";

describe("getRoleDifficulty", () => {
  it("returns the default coefficient for a known role with no override", () => {
    expect(getRoleDifficulty("VOYANTE")).toBe(DEFAULT_ROLE_DIFFICULTY.VOYANTE);
  });

  it("prefers an override over the default", () => {
    expect(getRoleDifficulty("VOYANTE", { VOYANTE: 2.5 })).toBe(2.5);
  });

  it("NEUTRAL_ROLE_DIFFICULTY is 1.0 (a role with no configured coefficient at all should never be penalized or boosted)", () => {
    expect(NEUTRAL_ROLE_DIFFICULTY).toBe(1.0);
  });

  it("every currently-existing role has an explicit default of at least 1.0", () => {
    const roleIds: (keyof typeof DEFAULT_ROLE_DIFFICULTY)[] = [
      "VILLAGEOIS",
      "LOUP_GAROU",
      "LOUP_BLANC",
      "LOUP_VERT",
      "SORCIERE",
      "VOYANTE",
      "SALVATEUR",
      "CHASSEUR",
      "CORBEAU",
      "MOWGLI",
      "BARBIE",
      "ALIEN",
    ];
    for (const id of roleIds) {
      expect(DEFAULT_ROLE_DIFFICULTY[id]).toBeGreaterThanOrEqual(1.0);
    }
  });
});
