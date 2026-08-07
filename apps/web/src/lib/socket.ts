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

export function emitWithAck<T = unknown>(event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    getSocket().emit(event, payload, (res: AckResponse<T>) => {
      if (res.ok) resolve(res.data as T);
      else reject(new Error(res.error));
    });
  });
}
