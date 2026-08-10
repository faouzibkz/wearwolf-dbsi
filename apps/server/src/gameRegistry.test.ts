import { describe, expect, it } from "vitest";
import { GameEngine } from "@loupgarou/game-engine";
import { gameRegistry } from "./gameRegistry.js";

/**
 * Covers the account-based reconnect support added to GameRegistry:
 * findPlayerIdForUser (does this account already have a seat in THIS
 * game?) and the currentSocketByPlayerId bookkeeping that guards the
 * "disconnect" handler in socket/handlers.ts against a stale-tab race.
 *
 * gameRegistry is a module-level singleton, so each test uses its own
 * freshly created GameEngine/player ids to avoid cross-test interference
 * (the maps are keyed by playerId, which is globally unique per
 * util/ids.ts, so distinct engines never collide with each other here).
 */
describe("GameRegistry — account-based reconnect", () => {
  function bootGame() {
    const engine = GameEngine.createGame({ roleCounts: { VILLAGEOIS: 3 } as any });
    const alice = engine.addPlayer("Alice");
    const bob = engine.addPlayer("Bob");
    return { engine, alice, bob };
  }

  describe("findPlayerIdForUser", () => {
    it("returns undefined when the account has no seat in this game", () => {
      const { engine } = bootGame();
      expect(gameRegistry.findPlayerIdForUser(engine, "user-nobody")).toBeUndefined();
    });

    it("finds the existing player once the account has been linked via setPlayerUserId", () => {
      const { engine, alice } = bootGame();
      gameRegistry.setPlayerUserId(alice.id, "user-alice");
      expect(gameRegistry.findPlayerIdForUser(engine, "user-alice")).toBe(alice.id);
    });

    it("is scoped to one engine's own roster, not the flat cross-game map", () => {
      const { engine: gameA, alice: aliceInA } = bootGame();
      const { engine: gameB } = bootGame();
      gameRegistry.setPlayerUserId(aliceInA.id, "user-alice-2");
      // Same userId, but aliceInA.id isn't a player in gameB at all.
      expect(gameRegistry.findPlayerIdForUser(gameB, "user-alice-2")).toBeUndefined();
      expect(gameRegistry.findPlayerIdForUser(gameA, "user-alice-2")).toBe(aliceInA.id);
    });

    it("distinguishes two different accounts seated in the same game", () => {
      const { engine, alice, bob } = bootGame();
      gameRegistry.setPlayerUserId(alice.id, "user-alice-3");
      gameRegistry.setPlayerUserId(bob.id, "user-bob-3");
      expect(gameRegistry.findPlayerIdForUser(engine, "user-alice-3")).toBe(alice.id);
      expect(gameRegistry.findPlayerIdForUser(engine, "user-bob-3")).toBe(bob.id);
    });
  });

  describe("current-socket tracking", () => {
    it("reports isCurrentSocket false until a socket has been set", () => {
      const { alice } = bootGame();
      expect(gameRegistry.isCurrentSocket(alice.id, "socket-1")).toBe(false);
    });

    it("reports true only for the most recently set socket for that player", () => {
      const { alice } = bootGame();
      gameRegistry.setCurrentSocket(alice.id, "socket-old");
      expect(gameRegistry.isCurrentSocket(alice.id, "socket-old")).toBe(true);

      // A new tab/device reconnects — this is exactly the stale-tab race
      // the disconnect handler in socket/handlers.ts guards against.
      gameRegistry.setCurrentSocket(alice.id, "socket-new");
      expect(gameRegistry.isCurrentSocket(alice.id, "socket-new")).toBe(true);
      expect(gameRegistry.isCurrentSocket(alice.id, "socket-old")).toBe(false);
    });
  });

  describe("clearPlayerUserIds", () => {
    it("clears both the userId link and the current-socket entry", () => {
      const { engine, alice } = bootGame();
      gameRegistry.setPlayerUserId(alice.id, "user-to-clear");
      gameRegistry.setCurrentSocket(alice.id, "socket-to-clear");
      expect(gameRegistry.findPlayerIdForUser(engine, "user-to-clear")).toBe(alice.id);

      gameRegistry.clearPlayerUserIds([alice.id]);

      expect(gameRegistry.findPlayerIdForUser(engine, "user-to-clear")).toBeUndefined();
      expect(gameRegistry.isCurrentSocket(alice.id, "socket-to-clear")).toBe(false);
    });
  });
});
