import jwt from "jsonwebtoken";
import { config } from "../config.js";

export interface SessionTokenPayload {
  userId: string;
  username: string;
}

export function signSessionToken(payload: SessionTokenPayload): string {
  return jwt.sign(payload, config.auth.jwtSecret, { expiresIn: config.auth.sessionTtlSeconds });
}

/** Returns null on any invalid/expired/tampered token instead of throwing — callers just treat that as "not logged in". */
export function verifySessionToken(token: string): SessionTokenPayload | null {
  try {
    const decoded = jwt.verify(token, config.auth.jwtSecret);
    if (typeof decoded !== "object" || decoded === null) return null;
    const { userId, username } = decoded as Record<string, unknown>;
    if (typeof userId !== "string" || typeof username !== "string") return null;
    return { userId, username };
  } catch {
    return null;
  }
}
