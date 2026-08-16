import { afterEach, describe, expect, it } from "vitest";
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

  describe("findOpenGamesForUser (Feature 4: rejoin popup)", () => {
    // These games must actually be registered (via gameRegistry.create, not
    // a bare GameEngine.createGame like bootGame() above) so
    // findOpenGamesForUser — which scans the registry's own game Map — can
    // see them. Cleaned up in afterEach so they don't leak into other
    // describe blocks' assumptions about registry contents.
    const createdCodes: string[] = [];

    function createRegisteredGame() {
      const { engine } = gameRegistry.create({ roleCounts: { VILLAGEOIS: 3 } as any });
      createdCodes.push(engine.getCode());
      return engine;
    }

    it("returns an empty list for an account with no seats anywhere", () => {
      expect(gameRegistry.findOpenGamesForUser("user-with-nothing")).toEqual([]);
    });

    it("finds an account's seat in a LOBBY game", () => {
      const engine = createRegisteredGame();
      const bob = engine.addPlayer("Bob");
      gameRegistry.setPlayerUserId(bob.id, "user-bob-open");

      const open = gameRegistry.findOpenGamesForUser("user-bob-open");
      expect(open).toEqual([{ code: engine.getCode(), phase: "LOBBY", playerId: bob.id, nickname: "Bob" }]);
    });

    it("finds an account's seat in an in-progress game", () => {
      const engine = createRegisteredGame();
      engine.addPlayer("A");
      engine.addPlayer("B");
      engine.addPlayer("C");
      const dana = engine.addPlayer("Dana");
      gameRegistry.setPlayerUserId(dana.id, "user-dana-open");
      engine.startGame();

      const open = gameRegistry.findOpenGamesForUser("user-dana-open");
      expect(open).toHaveLength(1);
      expect(open[0]).toMatchObject({ code: engine.getCode(), playerId: dana.id, nickname: "Dana" });
      expect(open[0]!.phase).not.toBe("LOBBY");
    });

    it("excludes ENDED games — nothing left to rejoin", () => {
      const engine = createRegisteredGame();
      engine.addPlayer("A");
      engine.addPlayer("B");
      engine.addPlayer("C");
      const eve = engine.addPlayer("Eve");
      gameRegistry.setPlayerUserId(eve.id, "user-eve-ended");
      engine.startGame();
      engine.endGame(null);

      expect(gameRegistry.findOpenGamesForUser("user-eve-ended")).toEqual([]);
    });

    it("lists every open game an account has a seat in, across multiple games", () => {
      const gameA = createRegisteredGame();
      const gameB = createRegisteredGame();
      const seatA = gameA.addPlayer("Multi");
      const seatB = gameB.addPlayer("Multi");
      gameRegistry.setPlayerUserId(seatA.id, "user-multigame");
      gameRegistry.setPlayerUserId(seatB.id, "user-multigame");

      const open = gameRegistry.findOpenGamesForUser("user-multigame");
      expect(open.map((g) => g.code).sort()).toEqual([gameA.getCode(), gameB.getCode()].sort());
    });

    afterEach(() => {
      for (const code of createdCodes.splice(0)) gameRegistry.remove(code);
    });
  });
});
