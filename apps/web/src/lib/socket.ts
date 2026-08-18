"use client";

import { io, type Socket } from "socket.io-client";
import { MAX_ATTEMPTS, TransportError, delayForRetry, generateRequestId } from "./retryPolicy";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

let socket: Socket | null = null;

/** One shared Socket.IO connection per browser tab, created lazily on first use. */
export function getSocket(): Socket {
  if (!socket) {
    // withCredentials so the httpOnly session cookie set by /api/auth/*
    // (see apps/server/src/auth/cookies.ts) actually rides along on the
    // socket handshake — that's how PLAYER_JOIN/PLAYER_RECONNECT know which
    // account is behind this connection, with no token ever touching a
    // socket payload.
    socket = io(SERVER_URL, { autoConnect: true, transports: ["websocket", "polling"], withCredentials: true });
  }
  return socket;
}

export type AckResponse<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

/**
 * 17 août 2026 — every game action (night powers, votes, everything) routes
 * through this one function, and it used to have NO timeout: if the ack
 * never came back (a phone's connection dropping/reconnecting mid-request
 * is the common real case — the old socket's pending callback is simply
 * orphaned when a new connection replaces it), this Promise just hung
 * forever. That used to be harmless because callers didn't wait on it. Once
 * night actions/votes were changed to actually await this before confirming
 * success (see NightPromptPanel's submitAndConfirm), a lost ack turned into
 * an indefinitely frozen button with no error and no way to retry — exactly
 * the "Voyante checked but nothing happened" / "struggling to vote or kill"
 * reports from a real 10-player game. `.timeout()` guarantees this always
 * settles one way or the other within a bounded time.
 */
const ACK_TIMEOUT_MS = 10_000;

/**
 * Minimal shape emitWithAckOn actually needs from a socket, so tests can
 * pass a small fake instead of a real socket.io-client connection — see
 * socket.test.ts.
 */
export interface AckCapableSocket {
  connected: boolean;
  timeout(ms: number): { emit(event: string, payload: unknown, cb: (err: Error | null, res?: AckResponse) => void): void };
  once(event: "connect", cb: () => void): void;
  off(event: "connect", cb: () => void): void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves after `ms`, or as soon as the socket reconnects — whichever comes first. Never rejects: giving up on waiting just means the next attempt's own ACK_TIMEOUT_MS does the rejecting instead. */
function waitBeforeRetry(sock: AckCapableSocket, ms: number): Promise<void> {
  if (sock.connected) return sleep(ms);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      sock.off("connect", onConnect);
      resolve();
    }, ms);
    function onConnect(): void {
      clearTimeout(timer);
      resolve();
    }
    sock.once("connect", onConnect);
  });
}

function attemptOnce<T>(sock: AckCapableSocket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    sock.timeout(ACK_TIMEOUT_MS).emit(event, payload, (err, res) => {
      if (err) {
        reject(new TransportError());
        return;
      }
      if (res?.ok) resolve(res.data as T);
      // An application-level rejection (server understood the request and
      // said no) is a normal Error, NOT a TransportError — the retry loop
      // below must never retry this branch.
      else reject(new Error(res?.error ?? "Erreur inconnue."));
    });
  });
}

/**
 * 18 août 2026 (FEATURES.md §25) — "he'll confirm his target to kill /
 * protect... and if that fails he will not notice but the server will
 * retry automatically" — this is that retry. Every payload gets a __rid
 * (request id), generated once and reused across every attempt of the
 * SAME logical call, so a retry the server actually received the first
 * time around (its ack just got lost) replays the original result instead
 * of re-applying the action — see apps/server/src/socket/idempotency.ts.
 *
 * Only TransportError (ack timeout / no ack at all) triggers a retry.
 * A real application-level rejection surfaces immediately, unchanged from
 * before — retrying "ce n'est pas votre tour" can't fix it.
 *
 * Exported separately from emitWithAck (which just calls this with the
 * real getSocket()) so tests can drive the retry loop against a small fake
 * socket instead of a live socket.io connection.
 */
export async function emitWithAckOn<T = unknown>(sock: AckCapableSocket, event: string, payload: unknown): Promise<T> {
  const taggedPayload = payload && typeof payload === "object" ? { ...payload, __rid: generateRequestId() } : payload;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await waitBeforeRetry(sock, delayForRetry(attempt - 1));
    }
    try {
      return await attemptOnce<T>(sock, event, taggedPayload);
    } catch (err) {
      const isLastAttempt = attempt === MAX_ATTEMPTS - 1;
      if (!(err instanceof TransportError) || isLastAttempt) {
        throw err;
      }
      // else: transport failure, attempts remain — loop around and retry.
    }
  }
  // Unreachable (the loop above always returns or throws), but keeps
  // TypeScript happy about every code path returning a value.
  throw new TransportError();
}

export function emitWithAck<T = unknown>(event: string, payload: unknown): Promise<T> {
  return emitWithAckOn<T>(getSocket(), event, payload);
}
