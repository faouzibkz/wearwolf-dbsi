import type { Server } from "socket.io";
import { SOCKET_EVENTS, type GameClosedPayload } from "@loupgarou/shared";
import { gameRegistry } from "../gameRegistry.js";
import { roomForGame } from "./broadcast.js";

/**
 * Nothing in this app ever used to close a game on its own — a LOBBY an
 * admin created, shared, and then abandoned (or just replaced by creating
 * a second game) stayed in gameRegistry's in-memory Map forever, as did any
 * ENDED game long after its last player had looked at the results/MVP vote.
 * This module is the fix: a periodic sweep that purges games nobody's
 * touched in a while, so a long-running server process doesn't slowly leak
 * memory across however many games get created over its lifetime.
 *
 * "Touched" = gameRegistry.lastActivityAt, bumped by gameRegistry.touch()
 * from requireGame() — the one chokepoint nearly every mutating socket
 * handler already goes through, so this stays fresh for free, with zero
 * per-handler bookkeeping.
 *
 * Three different thresholds, because "idle" means different things
 * depending on the phase:
 *   - LOBBY: nobody ever pressed "start" — the most likely abandonment case
 *     (an admin creates a game, shares the code, gets no takers or loses
 *     interest, and just creates another one instead). Short fuse.
 *   - ENDED: the game is fully resolved; all that's left is players looking
 *     at the results screen and/or the post-game MVP vote (which has its
 *     own, separate auto-finalize deadline — see mvpTimer.ts). Give that a
 *     reasonable window, then clear it.
 *   - Anything else (an in-progress game — CHEF_CANDIDACY through
 *     DAY_VOTE_RESULT/NIGHT/etc.): normally always has an active phase
 *     timer ticking, so "idle" here specifically means every socket
 *     disconnected and nobody's coming back — a much longer fuse, since a
 *     real table can legitimately pause (bathroom break, half-time) for a
 *     while without anyone touching the server.
 */
export const IDLE_LOBBY_MS = 60 * 60 * 1000; // 60 minutes
export const IDLE_ENDED_MS = 30 * 60 * 1000; // 30 minutes
export const IDLE_ABANDONED_MS = 4 * 60 * 60 * 1000; // 4 hours

function reasonAndMessageFor(phase: string): { reason: GameClosedPayload["reason"]; message: string } | null {
  if (phase === "LOBBY") {
    return {
      reason: "IDLE_LOBBY",
      message: "Cette partie a été fermée automatiquement (lobby inactif trop longtemps).",
    };
  }
  if (phase === "ENDED") {
    return {
      reason: "IDLE_ENDED",
      message: "Cette partie a été fermée automatiquement (terminée depuis trop longtemps).",
    };
  }
  return {
    reason: "IDLE_ABANDONED",
    message: "Cette partie a été fermée automatiquement (aucune activité depuis trop longtemps).",
  };
}

function idleThresholdFor(phase: string): number {
  if (phase === "LOBBY") return IDLE_LOBBY_MS;
  if (phase === "ENDED") return IDLE_ENDED_MS;
  return IDLE_ABANDONED_MS;
}

/**
 * Runs one sweep right now — checks every registered game's phase +
 * lastActivityAt against its threshold, notifies (GAME_CLOSED) and purges
 * whichever ones are past it. Exported directly (not just via the
 * setInterval wrapper below) so it's independently testable without fake
 * timers.
 */
export function sweepIdleGames(io: Server, now: number = Date.now()): string[] {
  const closedCodes: string[] = [];
  for (const code of gameRegistry.codes()) {
    const engine = gameRegistry.get(code);
    if (!engine) continue; // raced with something else clearing it mid-sweep
    const lastActivity = gameRegistry.getLastActivityAt(code) ?? now;
    const phase = engine.getPhase();
    const threshold = idleThresholdFor(phase);
    if (now - lastActivity < threshold) continue;

    const info = reasonAndMessageFor(phase);
    if (!info) continue;

    const payload: GameClosedPayload = { code, reason: info.reason, message: info.message };
    io.to(roomForGame(code)).emit(SOCKET_EVENTS.GAME_CLOSED, payload);
    io.in(roomForGame(code)).socketsLeave(roomForGame(code));
    gameRegistry.remove(code);
    closedCodes.push(code);
  }
  return closedCodes;
}

let sweepHandle: NodeJS.Timeout | null = null;

/** Default sweep cadence — frequent enough that nothing lingers much past its own threshold, cheap enough not to matter. */
export const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function startIdleCleanupSweep(io: Server, intervalMs: number = DEFAULT_SWEEP_INTERVAL_MS): void {
  stopIdleCleanupSweep();
  sweepHandle = setInterval(() => {
    try {
      sweepIdleGames(io);
    } catch (err) {
      console.error("[idle-cleanup] sweep failed", err);
    }
  }, intervalMs);
  // Don't hold the process open just for this timer (matters for clean
  // shutdown / tests that boot the server without ever calling stop()).
  sweepHandle.unref?.();
}

export function stopIdleCleanupSweep(): void {
  if (sweepHandle) {
    clearInterval(sweepHandle);
    sweepHandle = null;
  }
}
