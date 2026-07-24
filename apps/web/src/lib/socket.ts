"use client";

import { io, type Socket } from "socket.io-client";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

let socket: Socket | null = null;

/** One shared Socket.IO connection per browser tab, created lazily on first use. */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(SERVER_URL, { autoConnect: true, transports: ["websocket", "polling"] });
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
