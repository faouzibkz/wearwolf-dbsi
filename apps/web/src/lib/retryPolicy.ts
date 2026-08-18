/**
 * 18 août 2026 (FEATURES.md §25) — pure retry policy for emitWithAck.
 *
 * Kept deliberately free of socket.io/DOM dependencies so it can be unit
 * tested directly (see retryPolicy.test.ts) without spinning up a real or
 * fake socket connection — the actual retry LOOP lives in socket.ts and
 * imports these constants/helpers rather than re-deriving them.
 *
 * Design: after an ack times out or the local socket is disconnected when
 * an emit would go out, wait up to RETRY_DELAYS_MS[attempt] (but resolve
 * early the moment the socket reconnects) and try again, reusing the SAME
 * request id so a server that already applied the first attempt (its ack
 * just got lost on the way back) replays that result instead of applying
 * the action a second time — see apps/server/src/socket/idempotency.ts for
 * the server half of that contract.
 *
 * A genuine application-level rejection (the server understood the request
 * and said no — wrong turn, invalid target, etc.) is NEVER retried: only a
 * transport-level failure (ack timeout, socket not connected) is, since
 * retrying a real rejection can't fix it and would just delay the player
 * seeing the actual reason.
 */

export const MAX_ATTEMPTS = 3;
export const RETRY_DELAYS_MS: readonly number[] = [1500, 3000];

if (RETRY_DELAYS_MS.length !== MAX_ATTEMPTS - 1) {
  // Defensive — keeps the two constants from silently drifting apart if
  // either is edited later without the other.
  throw new Error("RETRY_DELAYS_MS must have exactly MAX_ATTEMPTS - 1 entries.");
}

/** Thrown for transport-level failures only (ack timeout) — the one error type emitWithAck's retry loop is allowed to swallow and retry. */
export class TransportError extends Error {
  constructor(message = "Le serveur ne répond pas — vérifiez votre connexion et réessayez.") {
    super(message);
    this.name = "TransportError";
  }
}

/** attemptIndex is 0-based: the delay BEFORE attempt 1, attempt 2, etc. Returns 0 past the end instead of throwing — callers loop `attempt < MAX_ATTEMPTS`, so this is never actually reached with a bad index, but a wrong result is much safer to have than a crash on the game's critical path. */
export function delayForRetry(attemptIndex: number): number {
  return RETRY_DELAYS_MS[attemptIndex] ?? 0;
}

/**
 * Random ID reused across every retry of the same logical action (generated
 * once per emitWithAck call, not per attempt) — this is the `__rid` the
 * server's wrapForIdempotency keys its dedup cache on.
 */
export function generateRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Extremely defensive fallback for a browser without crypto.randomUUID
  // (shouldn't happen for this app's target browsers) — a missing/weak
  // request id must never crash a submit, it just means that one call
  // doesn't get retry-dedup protection.
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
