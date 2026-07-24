import { describe, expect, it } from "vitest";
import { GameEngine } from "../engine/GameEngine";
import { seededRng } from "./helpers";

describe("global sound effects toggle", () => {
  it("defaults to enabled", () => {
    const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1 } }, seededRng(1));
    expect(engine.getPublicState().soundEffectsEnabled).toBe(true);
  });

  it("can be toggled from the lobby", () => {
    const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1 } }, seededRng(1));
    engine.setSoundEffectsEnabled(false);
    expect(engine.getPublicState().soundEffectsEnabled).toBe(false);
    engine.setSoundEffectsEnabled(true);
    expect(engine.getPublicState().soundEffectsEnabled).toBe(true);
  });

  it("can be toggled mid-game, unlike the rest of GameConfig (updateConfig is LOBBY-only)", () => {
    const names = ["A", "B", "C", "D"];
    const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1 } }, seededRng(1));
    const ids: Record<string, string> = {};
    for (const n of names) ids[n] = engine.addPlayer(n).id;
    engine.startGame();
    engine.volunteerForChef(ids.A!);
    engine.forceStartChefDebate();
    engine.advanceChefSpeaker();
    for (const n of ["B", "C", "D"]) engine.castChefVote(ids[n]!, ids.A!);
    engine.tallyChefVoteAndProceed();
    engine.endDay1Discussion();

    // updateConfig would throw here (post-LOBBY); setSoundEffectsEnabled must not.
    expect(() => engine.updateConfig({ soundEffectsEnabled: false })).toThrow();
    expect(() => engine.setSoundEffectsEnabled(false)).not.toThrow();
    expect(engine.getPublicState().soundEffectsEnabled).toBe(false);
  });
});
