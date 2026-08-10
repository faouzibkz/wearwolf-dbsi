import type { GameEngine } from "@loupgarou/game-engine";
import { gameRegistry } from "../gameRegistry.js";

export interface ReplayRosterEntry {
  oldPlayerId: string;
  newPlayerId: string;
  reconnectToken: string;
}

export interface CreateReplayGameResult {
  engine: GameEngine;
  hostToken: string;
  roster: ReplayRosterEntry[];
}

/**
 * Instant replay: creates a brand-new game using the ended game's exact
 * config, then seats every one of its players under their same pseudo —
 * carrying the account link (GameRegistry's userId map) along too, so
 * history/stats on the new game still attach to the right account. Roles
 * are NOT assigned here (the new game starts in LOBBY, same as any other
 * freshly created game) — that only happens once someone calls
 * ADMIN_START_GAME on it, same-config replay or not.
 *
 * Caller (socket/handlers.ts's REPLAY_REQUEST handler) is responsible for
 * validating the requester actually holds the OLD game's hostToken before
 * ever calling this, and for turning `roster` into the REPLAY_STARTED
 * pushes / the requester's own ack response.
 */
export function createReplayGame(oldEngine: GameEngine): CreateReplayGameResult {
  const { engine, hostToken } = gameRegistry.create(oldEngine.getConfig());
  const roster: ReplayRosterEntry[] = oldEngine.getPlayers().map((oldPlayer) => {
    const newPlayer = engine.addPlayer(oldPlayer.nickname);
    const userId = gameRegistry.getPlayerUserId(oldPlayer.id);
    if (userId) gameRegistry.setPlayerUserId(newPlayer.id, userId);
    return { oldPlayerId: oldPlayer.id, newPlayerId: newPlayer.id, reconnectToken: newPlayer.reconnectToken };
  });
  return { engine, hostToken, roster };
}
