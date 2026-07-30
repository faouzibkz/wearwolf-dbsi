"use client";

export interface PlayerSession {
  gameCode: string;
  playerId: string;
  reconnectToken: string;
  nickname: string;
}

const PLAYER_KEY = "loupgarou:player";
const ADMIN_KEY = "loupgarou:admin";

export function savePlayerSession(session: PlayerSession): void {
  localStorage.setItem(PLAYER_KEY, JSON.stringify(session));
}

export function loadPlayerSession(gameCode: string): PlayerSession | null {
  const raw = localStorage.getItem(PLAYER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PlayerSession;
    return parsed.gameCode === gameCode.toUpperCase() ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPlayerSession(): void {
  localStorage.removeItem(PLAYER_KEY);
}

export interface AdminSession {
  hostToken: string;
  gameCode: string;
}

export function saveAdminSession(session: AdminSession): void {
  localStorage.setItem(ADMIN_KEY, JSON.stringify(session));
}

export function loadAdminSession(): AdminSession | null {
  const raw = localStorage.getItem(ADMIN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AdminSession;
  } catch {
    return null;
  }
}

export function clearAdminSession(): void {
  localStorage.removeItem(ADMIN_KEY);
}
