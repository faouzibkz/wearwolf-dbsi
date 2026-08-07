"use client";

import { SOCKET_EVENTS, type TimeSyncResultPayload } from "@loupgarou/shared";
import { emitWithAck, getSocket } from "./socket";

/**
 * Estimated (serverTime - Date.now()) offset, in ms. Zero until the first
 * successful measurement, which is fine — that just means getServerNow()
 * behaves exactly like Date.now() until we know better.
 *
 * Why this exists: CountdownTimer renders `phaseEndsAt - now`, where
 * phaseEndsAt is a deadline the SERVER computed against ITS clock. If the
 * browser's clock is even a few seconds ahead of the server's (a laptop's
 * Docker/WSL2 VM clock is a classic source of this after the machine wakes
 * from sleep), the on-screen countdown reaches 0:00 while the server is
 * still genuinely counting down — exactly the reported "stuck at 0:00 for
 * several seconds, then it suddenly advances" bug. Anchoring every
 * countdown to getServerNow() instead of Date.now() makes the DISPLAYED
 * countdown match the ACTUAL deadline regardless of clock skew.
 */
let offsetMs = 0;

/** Server-equivalent "now". Use this instead of Date.now() for anything compared against a server-issued deadline (phaseEndsAt, prompt deadlineAt, etc). */
export function getServerNow(): number {
  return Date.now() + offsetMs;
}

async function measureOnce(): Promise<void> {
  const sentAt = Date.now();
  try {
    const data = await emitWithAck<TimeSyncResultPayload>(SOCKET_EVENTS.TIME_SYNC, {});
    const receivedAt = Date.now();
    const roundTripMs = receivedAt - sentAt;
    // Assume the request and response each took half the round trip, so the
    // server's timestamp was taken roughly roundTripMs/2 before we saw it.
    const estimatedServerNowAtReceipt = data.serverNow + roundTripMs / 2;
    offsetMs = estimatedServerNowAtReceipt - receivedAt;
  } catch {
    // Best-effort: keep whatever offset we already had and just try again
    // on the next tick / next reconnect rather than throwing.
  }
}

let started = false;

/**
 * Idempotent — safe to call from every page that shows a countdown. Only
 * the first call actually wires anything up; measures immediately on
 * connect and then periodically, so long-running sessions (a laptop that
 * sleeps mid-game) self-correct instead of drifting further and further
 * out of sync.
 */
export function startClockSync(): void {
  if (started) return;
  started = true;
  const socket = getSocket();
  socket.on("connect", measureOnce);
  if (socket.connected) void measureOnce();
  setInterval(measureOnce, 20_000);
}
