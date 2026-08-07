"use client";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Thin fetch wrapper for the REST side of the server (accounts/profile/
 * history — see apps/server/src/http/*). `credentials: "include"` is what
 * makes the httpOnly session cookie set by /api/auth/* actually ride along
 * on every one of these calls; without it every request would look logged
 * out. Socket.IO has its own equivalent (withCredentials) in lib/socket.ts.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (res.status === 204) return undefined as T;
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // No JSON body (e.g. a 204, or an unexpected non-JSON error page).
  }
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : `Erreur ${res.status}`;
    throw new ApiError(message, res.status);
  }
  return body as T;
}
