import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine } from "@loupgarou/game-engine";
import { DEFAULT_TIMERS, SOCKET_EVENTS, type MvpResultPayload, type MvpStatePayload } from "@loupgarou/shared";

// Same reasoning as timerOrdering.test.ts: sync() pulls in Prisma through
// several DB-writing paths that only actually run once GAME_ENDED fires —
// which every scenario below deliberately triggers — so this has to be
// mocked at the source module to satisfy the import graph without real
// network/DB access in this sandbox. finalizeGameHistory etc. all resolve
// to harmless no-ops; nothing here asserts on their result.
vi.mock("../db/prisma.js", () => ({ prisma: { game: { upsert: vi.fn().mockResolvedValue({}) } } }));
vi.mock("../db/persistence.js", () => ({
  finalizeGameHistory: vi.fn().mockResolvedValue(undefined),
  persistGame: vi.fn().mockResolvedValue(undefined),
  listPresets: vi.fn(),
  savePreset: vi.fn(),
}));
vi.mock("../rating/applyRating.js", () => ({ applyRatingUpdates: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../progression/applyProgression.js", () => ({
  applyBaseProgression: vi.fn().mockResolvedValue(undefined),
  applyMvpBonus: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../badges/applyBadges.js", () => ({
  applyBadgesForUser: vi.fn().mockResolvedValue(undefined),
  applyBadgesForMvpWinners: vi.fn().mockResolvedValue(undefined),
}));

import { sync } from "./handlers.js";

/**
 * Feature: post-game MVP voting now carries its own safety-net deadline
 * (TimerConfig.mvpVote — see mvp/mvpVotingRegistry.ts and mvpTimer.ts).
 * These tests exercise the REAL sync() -> mvpVotingRegistry.open() ->
 * scheduleMvpVoteTimer() wiring with fake timers, the same style as
 * timerOrdering.test.ts, rather than reimplementing the wiring by hand.
 */
function fakeIo() {
  const emittedByRoom: Record<string, unknown[]> = {};
  const emittedEventsByRoom: Record<string, string[]> = {};
  const io = {
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          (emittedByRoom[room] ??= []).push(payload);
          (emittedEventsByRoom[room] ??= []).push(event);
        },
      };
    },
  };
  return { io: io as any, emittedByRoom, emittedEventsByRoom };
}

/** 4 players — the engine's minimum — one wolf, three villagers, killed off by the admin-kill path to reach ENDED (VILLAGE win) in one step without playing an entire game out. */
function bootToGameEnded(mvpVoteSeconds: number) {
  const engine = GameEngine.createGame({
    roleCounts: { LOUP_GAROU: 1 },
    timers: { ...DEFAULT_TIMERS, mvpVote: mvpVoteSeconds },
  } as any);
  const ids: string[] = [];
  for (const n of ["A", "B", "C", "D"]) ids.push(engine.addPlayer(n).id);
  engine.startGame();
  const wolfId = engine.getAdminRoles().find((r) => r.roleId === "LOUP_GAROU")!.playerId;
  engine.adminKillPlayer(wolfId);
  expect(engine.getPhase()).toBe("ENDED");
  return { engine, ids };
}

function latest<T>(emittedByRoom: Record<string, unknown[]>, emittedEventsByRoom: Record<string, string[]>, code: string, event: string): T | undefined {
  const room = `game:${code.toUpperCase()}`;
  const payloads = emittedByRoom[room] ?? [];
  const events = emittedEventsByRoom[room] ?? [];
  for (let i = payloads.length - 1; i >= 0; i--) {
    if (events[i] === event) return payloads[i] as T;
  }
  return undefined;
}

describe("post-game MVP vote — deadline safety net", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opening the vote broadcasts a deadlineAt exactly TimerConfig.mvpVote seconds out", () => {
    const { engine } = bootToGameEnded(120);
    const { io, emittedByRoom, emittedEventsByRoom } = fakeIo();
    sync(io, engine);

    const state = latest<MvpStatePayload>(emittedByRoom, emittedEventsByRoom, engine.getCode(), SOCKET_EVENTS.MVP_STATE);
    expect(state).toBeDefined();
    expect(state!.deadlineAt).toBe(Date.now() + 120_000);
  });

  it("letting the deadline elapse with nobody having voted force-finalizes with zero winners", () => {
    const { engine } = bootToGameEnded(120);
    const { io, emittedByRoom, emittedEventsByRoom } = fakeIo();
    sync(io, engine);

    expect(latest(emittedByRoom, emittedEventsByRoom, engine.getCode(), SOCKET_EVENTS.MVP_RESULT)).toBeUndefined();

    vi.advanceTimersByTime(120_000);

    const result = latest<MvpResultPayload>(emittedByRoom, emittedEventsByRoom, engine.getCode(), SOCKET_EVENTS.MVP_RESULT);
    expect(result).toBeDefined();
    expect(result!.winners).toEqual([]);
  });

  it("letting the deadline elapse with only a minority having voted still force-finalizes with whatever ballots are in", async () => {
    const { engine, ids } = bootToGameEnded(120);
    const { io, emittedByRoom, emittedEventsByRoom } = fakeIo();
    sync(io, engine);

    // Only one of the four eligible players votes — a genuine minority.
    const { mvpVotingRegistry } = await import("../mvp/mvpVotingRegistry.js");
    mvpVotingRegistry.castVote(engine.getCode(), ids[0]!, ids[1]!);

    vi.advanceTimersByTime(120_000);

    const result = latest<MvpResultPayload>(emittedByRoom, emittedEventsByRoom, engine.getCode(), SOCKET_EVENTS.MVP_RESULT);
    expect(result).toBeDefined();
    expect(result!.winners.map((w) => w.playerId)).toEqual([ids[1]]);
  });

  it("if voting already finalized before the deadline fires, the timer is a no-op (no second MVP_RESULT broadcast)", async () => {
    const { engine, ids } = bootToGameEnded(120);
    const { io, emittedByRoom, emittedEventsByRoom } = fakeIo();
    sync(io, engine);

    // Simulate "everyone voted and it finalized naturally" — same effect
    // MVP_VOTE_CAST's own isComplete() check produces, just invoked
    // directly here since that socket handler needs a real socket.io
    // connection to exercise end-to-end (already covered at the pure-tally
    // level by mvp/mvpVotingRegistry.test.ts).
    const { mvpVotingRegistry } = await import("../mvp/mvpVotingRegistry.js");
    for (const id of ids) mvpVotingRegistry.castVote(engine.getCode(), id, ids.find((other) => other !== id)!);
    mvpVotingRegistry.finalize(engine.getCode());

    const resultCountBefore = (emittedEventsByRoom[`game:${engine.getCode().toUpperCase()}`] ?? []).filter(
      (e) => e === SOCKET_EVENTS.MVP_RESULT,
    ).length;
    expect(resultCountBefore).toBe(0); // finalize() called directly on the registry doesn't itself broadcast

    vi.advanceTimersByTime(120_000);

    // The deadline timer sees state.finalized === true and skips entirely —
    // no MVP_RESULT ever gets broadcast through this path, so no duplicate
    // XP/badge award can be triggered either.
    const resultCountAfter = (emittedEventsByRoom[`game:${engine.getCode().toUpperCase()}`] ?? []).filter(
      (e) => e === SOCKET_EVENTS.MVP_RESULT,
    ).length;
    expect(resultCountAfter).toBe(0);
  });

  it("mvpVote: 0 disables the safety net entirely — voting waits forever", () => {
    const { engine } = bootToGameEnded(0);
    const { io, emittedByRoom, emittedEventsByRoom } = fakeIo();
    sync(io, engine);

    const state = latest<MvpStatePayload>(emittedByRoom, emittedEventsByRoom, engine.getCode(), SOCKET_EVENTS.MVP_STATE);
    expect(state!.deadlineAt).toBeNull();

    vi.advanceTimersByTime(365 * 24 * 60 * 60 * 1000); // a full year — still nothing

    expect(latest(emittedByRoom, emittedEventsByRoom, engine.getCode(), SOCKET_EVENTS.MVP_RESULT)).toBeUndefined();
  });
});
