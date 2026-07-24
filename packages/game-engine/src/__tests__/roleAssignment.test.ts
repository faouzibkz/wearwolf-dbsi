import { describe, expect, it } from "vitest";
import { makeGameWithPlayers } from "./helpers";

describe("role assignment", () => {
  it("assigns every configured role and fills the rest with Villageois", () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    const { engine } = makeGameWithPlayers(names, {
      roleCounts: { LOUP_GAROU: 2, VOYANTE: 1 },
    });
    engine.startGame();

    const roles = engine.getAdminRoles().map((r) => r.roleId);
    expect(roles.filter((r) => r === "LOUP_GAROU")).toHaveLength(2);
    expect(roles.filter((r) => r === "VOYANTE")).toHaveLength(1);
    expect(roles.filter((r) => r === "VILLAGEOIS")).toHaveLength(3);
    expect(roles).toHaveLength(6);
  });

  it("never reveals roles through the public state", () => {
    const { engine } = makeGameWithPlayers(["A", "B", "C", "D"]);
    engine.startGame();
    const publicState = engine.getPublicState();
    expect(JSON.stringify(publicState)).not.toMatch(/LOUP_GAROU|VOYANTE|VILLAGEOIS/);
  });

  it("rejects starting with more configured roles than players", () => {
    const { engine } = makeGameWithPlayers(["A", "B"], { roleCounts: { LOUP_GAROU: 3 } });
    expect(() => engine.startGame()).toThrow();
  });

  it("moves to CHEF_CANDIDACY after start, not directly to night", () => {
    const { engine } = makeGameWithPlayers(["A", "B", "C", "D"]);
    engine.startGame();
    expect(engine.getPhase()).toBe("CHEF_CANDIDACY");
  });
});
