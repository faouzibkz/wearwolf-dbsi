import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AckCapableSocket, AckResponse } from "./socket";
import { emitWithAckOn } from "./socket";

type EmitCall = { event: string; payload: unknown };
type EmitImpl = (event: string, payload: unknown, cb: (err: Error | null, res?: AckResponse) => void) => void;

/**
 * A minimal fake standing in for socket.io-client's Socket — just enough
 * of the surface emitWithAckOn actually touches (see AckCapableSocket) to
 * drive its retry loop deterministically in tests, without a real network
 * connection or the full socket.io-client machinery.
 */
class FakeSocket implements AckCapableSocket {
  connected = true;
  calls: EmitCall[] = [];
  private connectHandlers: (() => void)[] = [];

  constructor(private emitImpl: EmitImpl) {}

  timeout(_ms: number) {
    return {
      emit: (event: string, payload: unknown, cb: (err: Error | null, res?: AckResponse) => void) => {
        this.calls.push({ event, payload });
        this.emitImpl(event, payload, cb);
      },
    };
  }

  once(event: "connect", cb: () => void): void {
    if (event === "connect") this.connectHandlers.push(cb);
  }

  off(event: "connect", cb: () => void): void {
    if (event !== "connect") return;
    this.connectHandlers = this.connectHandlers.filter((h) => h !== cb);
  }

  /** Test helper: simulate the socket reconnecting. */
  triggerConnect(): void {
    this.connected = true;
    const handlers = this.connectHandlers.splice(0);
    for (const h of handlers) h();
  }
}

describe("emitWithAckOn", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves immediately on a successful first attempt, tagging the payload with a __rid", async () => {
    const sock = new FakeSocket((_event, _payload, cb) => cb(null, { ok: true, data: "hello" }));

    const result = await emitWithAckOn(sock, "NIGHT_ACTION_SUBMIT", { targetId: "p2" });

    expect(result).toBe("hello");
    expect(sock.calls).toHaveLength(1);
    const sentPayload = sock.calls[0].payload as { targetId: string; __rid: string };
    expect(sentPayload.targetId).toBe("p2");
    expect(typeof sentPayload.__rid).toBe("string");
    expect(sentPayload.__rid.length).toBeGreaterThan(0);
  });

  it("silently retries after an ack timeout and resolves once a later attempt succeeds — the player never has to notice", async () => {
    let attempt = 0;
    const sock = new FakeSocket((_event, _payload, cb) => {
      attempt++;
      if (attempt === 1) {
        cb(new Error("operation has timed out")); // simulates socket.io's own .timeout() ack-timeout error
      } else {
        cb(null, { ok: true, data: "applied-on-retry" });
      }
    });

    const promise = emitWithAckOn(sock, "NIGHT_ACTION_SUBMIT", { targetId: "p2" });
    await vi.advanceTimersByTimeAsync(5000); // covers the first retry delay
    const result = await promise;

    expect(result).toBe("applied-on-retry");
    expect(sock.calls).toHaveLength(2);
  });

  it("reuses the exact same __rid across every retry of one logical call", async () => {
    let attempt = 0;
    const sock = new FakeSocket((_event, _payload, cb) => {
      attempt++;
      if (attempt < 3) cb(new Error("timeout"));
      else cb(null, { ok: true, data: "ok" });
    });

    const promise = emitWithAckOn(sock, "DAY_VOTE_CAST", { targetId: "p3" });
    await vi.advanceTimersByTimeAsync(10000);
    await promise;

    expect(sock.calls).toHaveLength(3);
    const rids = sock.calls.map((c) => (c.payload as { __rid: string }).__rid);
    expect(new Set(rids).size).toBe(1); // every attempt sent the same request id
  });

  it("never retries a real application-level rejection (server understood and said no)", async () => {
    const sock = new FakeSocket((_event, _payload, cb) => cb(null, { ok: false, error: "Ce n'est pas votre tour." }));

    await expect(emitWithAckOn(sock, "DAY_VOTE_CAST", { targetId: "p2" })).rejects.toThrow("Ce n'est pas votre tour.");
    expect(sock.calls).toHaveLength(1); // no retry attempted
  });

  it("gives up and rejects after exhausting every attempt, if the connection never recovers", async () => {
    const sock = new FakeSocket((_event, _payload, cb) => cb(new Error("timeout")));

    const promise = emitWithAckOn(sock, "NIGHT_ACTION_SUBMIT", { targetId: "p2" });
    // Swallow the eventual rejection so it doesn't count as an unhandled rejection while timers advance.
    const assertion = expect(promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(20000);
    await assertion;

    expect(sock.calls.length).toBeGreaterThanOrEqual(3); // MAX_ATTEMPTS
  });

  it("waits for reconnection before retrying if the socket is currently disconnected, instead of firing straight into a dead connection", async () => {
    let attempt = 0;
    const sock = new FakeSocket((_event, _payload, cb) => {
      attempt++;
      if (attempt === 1) {
        cb(new Error("timeout"));
      } else {
        cb(null, { ok: true, data: "reconnected-then-worked" });
      }
    });
    sock.connected = false;

    const promise = emitWithAckOn(sock, "NIGHT_ACTION_SUBMIT", { targetId: "p2" });
    // First attempt fires and times out (attemptOnce doesn't check `connected`
    // itself — the wait-before-retry logic is what respects it). Let the
    // first attempt's synchronous callback resolve, then simulate the phone
    // coming back online before the fixed delay would have elapsed.
    await vi.advanceTimersByTimeAsync(0);
    sock.triggerConnect();
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;

    expect(result).toBe("reconnected-then-worked");
    expect(sock.calls).toHaveLength(2);
  });

  it("passes non-object payloads through unchanged (no __rid tagging attempted)", async () => {
    const sock = new FakeSocket((_event, payload, cb) => {
      expect(payload).toBeUndefined();
      cb(null, { ok: true, data: "fine" });
    });

    const result = await emitWithAckOn(sock, "TIME_SYNC", undefined);
    expect(result).toBe("fine");
  });
});
