"use client";

import { io, type Socket } from "socket.io-client";

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

export function emitWithAck<T = unknown>(event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    getSocket()
      .timeout(ACK_TIMEOUT_MS)
      .emit(event, payload, (err: Error | null, res?: AckResponse<T>) => {
        if (err) {
          reject(new Error("Le serveur ne répond pas — vérifiez votre connexion et réessayez."));
          return;
        }
        if (res?.ok) resolve(res.data as T);
        else reject(new Error(res?.error ?? "Erreur inconnue."));
      });
  });
}
