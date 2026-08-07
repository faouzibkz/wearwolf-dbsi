import * as cookie from "cookie";
import type { Request, Response } from "express";
import { config } from "../config.js";
import { verifySessionToken, type SessionTokenPayload } from "./jwt.js";

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(config.auth.cookieName, token, {
    httpOnly: true,
    sameSite: config.auth.cookieSameSite,
    secure: config.auth.cookieSecure,
    maxAge: config.auth.sessionTtlSeconds * 1000,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(config.auth.cookieName, {
    httpOnly: true,
    sameSite: config.auth.cookieSameSite,
    secure: config.auth.cookieSecure,
    path: "/",
  });
}

/**
 * Shared by both the Express auth routes AND the Socket.IO connection
 * handshake (see socket/handlers.ts's PLAYER_JOIN/PLAYER_RECONNECT) — a
 * raw `Cookie:` header is the one thing both transports actually have in
 * common, so parsing it here once avoids two divergent implementations.
 */
export function readSessionFromCookieHeader(cookieHeader: string | undefined): SessionTokenPayload | null {
  if (!cookieHeader) return null;
  const parsed = cookie.parse(cookieHeader);
  const token = parsed[config.auth.cookieName];
  if (!token) return null;
  return verifySessionToken(token);
}

export function readSessionFromRequest(req: Request): SessionTokenPayload | null {
  return readSessionFromCookieHeader(req.headers.cookie);
}
