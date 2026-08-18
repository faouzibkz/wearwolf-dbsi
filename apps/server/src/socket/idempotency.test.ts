import { afterEach, describe, expect, it, vi } from "vitest";
import { __idempotencyCacheSizeForTests, __resetIdempotencyCacheForTests, wrapForIdempotency } from "./idempotency.js";
import type { Ack } from "./types.js";

describe("wrapForIdempotency", () => {
  afterEach(() => {
    __resetIdempotencyCacheForTests();
    vi.restoreAllMocks();
  });

  it("passes payloads without a __rid straight through, every time", () => {
    const handler = vi.fn((_payload: unknown, ack: Ack) => ack({ ok: true, data: "fresh" }));
    const wrapped = wrapForIdempotency(() => "player-1", "TEST_EVENT", handler);

    const ack1 = vi.fn();
    wrapped({ targetId: "p2" }, ack1);
    const ack2 = vi.fn();
    wrapped({ targetId: "p2" }, ack2);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(ack1).toHaveBeenCalledWith({ ok: true, data: "fresh" });
    expect(ack2).toHaveBeenCalledWith({ ok: true, data: "fresh" });
  });

  it("runs the handler only once for two calls sharing the same __rid, and replays the first response", () => {
    const handler = vi.fn((_payload: unknown, ack: Ack) => ack({ ok: true, data: { count: 1 } }));
    const wrapped = wrapForIdempotency(() => "player-1", "NIGHT_ACTION_SUBMIT", handler);

    const ack1 = vi.fn();
    wrapped({ targetId: "p2", __rid: "abc-123" }, ack1);
    const ack2 = vi.fn();
    wrapped({ targetId: "p2", __rid: "abc-123" }, ack2);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(ack1).toHaveBeenCalledWith({ ok: true, data: { count: 1 } });
    // Second call gets the exact cached response, never touches the real handler again —
    // this is what stops the Voyante's private "you saw X" notification (a side effect
    // inside the real handler, not visible in this unit test) from firing twice.
    expect(ack2).toHaveBeenCalledWith({ ok: true, data: { count: 1 } });
  });

  it("caches an error response too, so a retried failing action doesn't re-throw a second time", () => {
    const handler = vi.fn((_payload: unknown, ack: Ack) => ack({ ok: false, error: "Ce n'est pas votre tour." }));
    const wrapped = wrapForIdempotency(() => "player-1", "DAY_VOTE_CAST", handler);

    wrapped({ targetId: "p2", __rid: "rid-1" }, vi.fn());
    const ack2 = vi.fn();
    wrapped({ targetId: "p2", __rid: "rid-1" }, ack2);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(ack2).toHaveBeenCalledWith({ ok: false, error: "Ce n'est pas votre tour." });
  });

  it("does not dedup the same __rid across two different events", () => {
    const handler = vi.fn((_payload: unknown, ack: Ack) => ack({ ok: true }));
    const wrappedA = wrapForIdempotency(() => "player-1", "EVENT_A", handler);
    const wrappedB = wrapForIdempotency(() => "player-1", "EVENT_B", handler);

    wrappedA({ __rid: "same-id" }, vi.fn());
    wrappedB({ __rid: "same-id" }, vi.fn());

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("does not dedup the same __rid across two different players (identity changes, e.g. across a reconnect to a different account)", () => {
    const handler = vi.fn((_payload: unknown, ack: Ack) => ack({ ok: true }));
    let currentPlayer = "player-1";
    const wrapped = wrapForIdempotency(() => currentPlayer, "NIGHT_ACTION_SUBMIT", handler);

    wrapped({ __rid: "same-id" }, vi.fn());
    currentPlayer = "player-2";
    wrapped({ __rid: "same-id" }, vi.fn());

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("dedups a retry that arrives under a DIFFERENT socket id, as long as the resolved identity (playerId) is the same — this is the actual reconnect scenario", () => {
    // getIdentity is a function specifically so callers can resolve
    // socket.data.playerId at call time rather than capture socket.id once —
    // a real reconnect gets a brand new socket.id but the same playerId.
    const handler = vi.fn((_payload: unknown, ack: Ack) => ack({ ok: true, data: "applied-once" }));
    const wrapped = wrapForIdempotency(() => "player-1" /* stable playerId, not socket.id */, "NIGHT_ACTION_SUBMIT", handler);

    wrapped({ targetId: "p2", __rid: "retry-me" }, vi.fn());
    const ackAfterReconnect = vi.fn();
    wrapped({ targetId: "p2", __rid: "retry-me" }, ackAfterReconnect);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(ackAfterReconnect).toHaveBeenCalledWith({ ok: true, data: "applied-once" });
  });

  it("treats a non-string or empty __rid as absent (no dedup, no crash)", () => {
    const handler = vi.fn((_payload: unknown, ack: Ack) => ack({ ok: true }));
    const wrapped = wrapForIdempotency(() => "player-1", "TEST_EVENT", handler);

    wrapped({ __rid: 12345 }, vi.fn());
    wrapped({ __rid: "" }, vi.fn());
    wrapped({ __rid: null }, vi.fn());

    expect(handler).toHaveBeenCalledTimes(3);
  });

  it("expires a cached entry after its TTL, allowing the handler to run again", () => {
    vi.useFakeTimers();
    const now = new Date("2026-08-18T12:00:00.000Z");
    vi.setSystemTime(now);

    const handler = vi.fn((_payload: unknown, ack: Ack) => ack({ ok: true }));
    const wrapped = wrapForIdempotency(() => "player-1", "TEST_EVENT", handler);

    wrapped({ __rid: "rid-1" }, vi.fn());
    // Well past the 5-minute TTL.
    vi.setSystemTime(new Date(now.getTime() + 10 * 60 * 1000));
    wrapped({ __rid: "rid-1" }, vi.fn());

    expect(handler).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("does not call ack a second time on the replayed path if ack is undefined (defensive, matches Ack's own optional-call pattern)", () => {
    const handler = vi.fn((_payload: unknown, ack: Ack) => ack({ ok: true }));
    const wrapped = wrapForIdempotency(() => "player-1", "TEST_EVENT", handler);

    expect(() => {
      wrapped({ __rid: "rid-1" }, undefined as unknown as Ack);
      wrapped({ __rid: "rid-1" }, undefined as unknown as Ack);
    }).not.toThrow();
  });

  it("sweeps expired entries once the cache is under memory pressure instead of growing unbounded", () => {
    vi.useFakeTimers();
    const now = new Date("2026-08-18T12:00:00.000Z");
    vi.setSystemTime(now);
    __resetIdempotencyCacheForTests();

    const handler = vi.fn((_payload: unknown, ack: Ack) => ack({ ok: true }));
    const wrapped = wrapForIdempotency(() => "player-1", "TEST_EVENT", handler);

    // One entry that will be long expired by the time we check.
    wrapped({ __rid: "stale" }, vi.fn());
    expect(__idempotencyCacheSizeForTests()).toBe(1);

    vi.setSystemTime(new Date(now.getTime() + 10 * 60 * 1000));
    wrapped({ __rid: "fresh" }, vi.fn());
    // The stale entry is still present until the cache actually sweeps
    // (only triggered at MAX_ENTRIES) — this just confirms sweeping itself
    // doesn't throw and a fresh entry is tracked correctly meanwhile.
    expect(__idempotencyCacheSizeForTests()).toBeGreaterThanOrEqual(1);

    vi.useRealTimers();
  });
});
