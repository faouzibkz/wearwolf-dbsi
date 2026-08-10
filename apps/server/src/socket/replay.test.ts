import { describe, expect, it } from "vitest";
import { GameEngine } from "@loupgarou/game-engine";
import { gameRegistry } from "../gameRegistry.js";
import { createReplayGame } from "./replay.js";

function bootEndedGame() {
  const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1, VILLAGEOIS: 3 } as any });
  const alice = engine.addPlayer("Alice");
  const bob = engine.addPlayer("Bob");
  const carol = engine.addPlayer("Carol");
  const dave = engine.addPlayer("Dave");
  engine.startGame();
  engine.endGame(); // admin escape hatch — same call ADMIN_END_GAME makes, forces phase to ENDED regardless of win condition
  return { engine, alice, bob, carol, dave };
}

describe("createReplayGame", () => {
  it("creates a fresh LOBBY game using the old game's exact config", () => {
    const { engine } = bootEndedGame();
    const { engine: newEngine } = createReplayGame(engine);
    expect(newEngine.getPhase()).toBe("LOBBY");
    expect(newEngine.getConfig().roleCounts).toEqual(engine.getConfig().roleCounts);
    expect(newEngine.getCode()).not.toBe(engine.getCode());
  });

  it("seats every old player under their exact same pseudo", () => {
    const { engine } = bootEndedGame();
    const { engine: newEngine } = createReplayGame(engine);
    const newNicknames = newEngine.getPlayers().map((p) => p.nickname).sort();
    expect(newNicknames).toEqual(["Alice", "Bob", "Carol", "Dave"]);
  });

  it("returns one roster entry per old player, mapping old id -> new id + a fresh reconnectToken", () => {
    const { engine, alice } = bootEndedGame();
    const { roster } = createReplayGame(engine);
    expect(roster).toHaveLength(4);
    const aliceEntry = roster.find((r) => r.oldPlayerId === alice.id)!;
    expect(aliceEntry).toBeDefined();
    expect(aliceEntry.newPlayerId).not.toBe(alice.id);
    expect(aliceEntry.reconnectToken).toBeTruthy();
    expect(aliceEntry.reconnectToken).not.toBe(alice.reconnectToken); // fresh token, not the stale old one
  });

  it("carries the account link (userId) over to the new player id", () => {
    const { engine, alice, bob } = bootEndedGame();
    gameRegistry.setPlayerUserId(alice.id, "user-alice-replay");
    // Bob deliberately has no linked account — replay must not choke on that.

    const { roster } = createReplayGame(engine);
    const aliceEntry = roster.find((r) => r.oldPlayerId === alice.id)!;
    const bobEntry = roster.find((r) => r.oldPlayerId === bob.id)!;

    expect(gameRegistry.getPlayerUserId(aliceEntry.newPlayerId)).toBe("user-alice-replay");
    expect(gameRegistry.getPlayerUserId(bobEntry.newPlayerId)).toBeUndefined();
  });

  it("issues a real hostToken for the new game, distinct from the old one", () => {
    const { engine } = bootEndedGame();
    const { engine: newEngine, hostToken } = createReplayGame(engine);
    expect(hostToken).toBeTruthy();
    expect(gameRegistry.isValidHostToken(newEngine.getCode(), hostToken)).toBe(true);
  });
});
