import { afterEach, describe, expect, it, vi } from "vitest";
import { SOCKET_EVENTS } from "@loupgarou/shared";

// idleCleanup.ts pulls in socket/broadcast.ts (for roomForGame), which also
// exports broadcastGameState -> persistGame -> Prisma. This sandbox has no
// generated Prisma client (see broadcast.test.ts's own note on this), so —
// same fix as that file — stub the DB layer out before anything imports it.
vi.mock("../db/persistence.js", () => ({ persistGame: vi.fn() }));

import { gameRegistry } from "../gameRegistry.js";
import {
  IDLE_ABANDONED_MS,
  IDLE_ENDED_MS,
  IDLE_LOBBY_MS,
  sweepIdleGames,
} from "./idleCleanup.js";

/**
 * Covers the idle/abandoned game auto-close sweep (Feature 3): a LOBBY
 * nobody ever started, an ENDED game long past its results screen, and an
 * abandoned in-progress game should all eventually get purged from
 * gameRegistry — everything else should be left alone.
 *
 * Minimal fake Socket.IO Server: just enough of `.to(room).emit(...)` and
 * `.in(room).socketsLeave(...)` to observe/no-op what sweepIdleGames sends,
 * without spinning up a real socket.io instance or network — same
 * convention as socket/broadcast.test.ts's fakeIo().
 */
function fakeIo() {
  const emitted: { room: string; event: string; payload: unknown }[] = [];
  const io = {
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          emitted.push({ room, event, payload });
        },
      };
    },
    in(_room: string) {
      return { socketsLeave: (_target: string) => {} };
    },
  };
  return { io: io as any, emitted };
}

describe("idleCleanup.sweepIdleGames", () => {
  const createdCodes: string[] = [];

  afterEach(() => {
    // gameRegistry is a module-level singleton — don't leak games created
    // by one test into the next test's sweep.
    for (const code of createdCodes.splice(0)) gameRegistry.remove(code);
  });

  function bootLobby() {
    const { engine } = gameRegistry.create({ roleCounts: { VILLAGEOIS: 3 } as any });
    createdCodes.push(engine.getCode());
    return engine;
  }

  it("leaves a fresh LOBBY alone", () => {
    const engine = bootLobby();
    const { io } = fakeIo();
    const closed = sweepIdleGames(io, Date.now());
    expect(closed).not.toContain(engine.getCode());
    expect(gameRegistry.get(engine.getCode())).toBeDefined();
  });

  it("purges a LOBBY idle past IDLE_LOBBY_MS, notifying its room with GAME_CLOSED/IDLE_LOBBY first", () => {
    const engine = bootLobby();
    const { io, emitted } = fakeIo();
    const future = Date.now() + IDLE_LOBBY_MS + 1000;
    const closed = sweepIdleGames(io, future);
    expect(closed).toContain(engine.getCode());
    expect(gameRegistry.get(engine.getCode())).toBeUndefined();

    const notice = emitted.find((e) => e.event === SOCKET_EVENTS.GAME_CLOSED);
    expect(notice).toBeDefined();
    expect(notice!.payload).toMatchObject({ code: engine.getCode(), reason: "IDLE_LOBBY" });
  });

  it("leaves a LOBBY alone if it's just short of the threshold", () => {
    const engine = bootLobby();
    const { io } = fakeIo();
    const almost = Date.now() + IDLE_LOBBY_MS - 1000;
    const closed = sweepIdleGames(io, almost);
    expect(closed).not.toContain(engine.getCode());
    expect(gameRegistry.get(engine.getCode())).toBeDefined();
  });

  it("purges an ENDED game past IDLE_ENDED_MS (shorter fuse than an idle LOBBY)", () => {
    const engine = bootLobby();
    engine.addPlayer("A");
    engine.addPlayer("B");
    engine.addPlayer("C");
    engine.addPlayer("D");
    engine.startGame();
    engine.endGame(null); // force straight to ENDED for this test
    expect(engine.getPhase()).toBe("ENDED");

    const { io } = fakeIo();
    const future = Date.now() + IDLE_ENDED_MS + 1000;
    const closed = sweepIdleGames(io, future);
    expect(closed).toContain(engine.getCode());
    expect(gameRegistry.get(engine.getCode())).toBeUndefined();
  });

  it("leaves an ENDED game alone if it's just short of IDLE_ENDED_MS", () => {
    const engine = bootLobby();
    engine.addPlayer("A");
    engine.addPlayer("B");
    engine.addPlayer("C");
    engine.addPlayer("D");
    engine.startGame();
    engine.endGame(null);

    const { io } = fakeIo();
    const closed = sweepIdleGames(io, Date.now() + IDLE_ENDED_MS - 1000);
    expect(closed).not.toContain(engine.getCode());
    expect(gameRegistry.get(engine.getCode())).toBeDefined();
  });

  it("purges an abandoned in-progress game past IDLE_ABANDONED_MS", () => {
    const engine = bootLobby();
    engine.addPlayer("A");
    engine.addPlayer("B");
    engine.addPlayer("C");
    engine.addPlayer("D");
    engine.startGame();
    expect(engine.getPhase()).not.toBe("LOBBY");
    expect(engine.getPhase()).not.toBe("ENDED");

    const { io } = fakeIo();
    const future = Date.now() + IDLE_ABANDONED_MS + 1000;
    const closed = sweepIdleGames(io, future);
    expect(closed).toContain(engine.getCode());
  });

  it("leaves an in-progress game alone well before IDLE_ABANDONED_MS", () => {
    const engine = bootLobby();
    engine.addPlayer("A");
    engine.addPlayer("B");
    engine.addPlayer("C");
    engine.addPlayer("D");
    engine.startGame();

    const { io } = fakeIo();
    const soon = Date.now() + IDLE_LOBBY_MS + 1000; // well past the (irrelevant) LOBBY threshold
    const closed = sweepIdleGames(io, soon);
    expect(closed).not.toContain(engine.getCode());
    expect(gameRegistry.get(engine.getCode())).toBeDefined();
  });

  it("any successful gameRegistry.requireGame() call resets the idle clock", () => {
    const engine = bootLobby();
    const { io } = fakeIo();

    // Half the threshold, then "touch" the game (as any real socket
    // handler does via requireGame()), then advance to just past the
    // ORIGINAL deadline — it should have survived because the clock reset.
    const halfway = Date.now() + IDLE_LOBBY_MS / 2;
    // Bug fix (18 août 2026): this used to be two separate `vi.spyOn(Date,
    // "now")` calls — one to mock, a second (discarding the first spy's
    // reference) just to call .mockRestore() on. That second call doesn't
    // restore the REAL Date.now; it wraps the already-mocked one and
    // "restores" back to THAT, so Date.now() stayed frozen at `halfway`
    // for the rest of the test. That silently broke the very thing this
    // test exists to guard: `justPastOriginalDeadline` below ended up
    // computed relative to `halfway` instead of the real original time,
    // landing past the RESET deadline too and making the assertion fail —
    // i.e. this test was (accidentally) proving a real game could get
    // closed early right after its idle clock was reset. Keeping the one
    // spy instance and restoring that exact instance fixes it.
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(halfway);
    gameRegistry.requireGame(engine.getCode());
    dateSpy.mockRestore();

    const justPastOriginalDeadline = Date.now() + IDLE_LOBBY_MS + 1000;
    const closed = sweepIdleGames(io, justPastOriginalDeadline);
    expect(closed).not.toContain(engine.getCode());

    // But well past the RESET deadline, it's still eventually purged.
    const pastResetDeadline = halfway + IDLE_LOBBY_MS + 1000;
    const closed2 = sweepIdleGames(io, pastResetDeadline);
    expect(closed2).toContain(engine.getCode());
  });
});
