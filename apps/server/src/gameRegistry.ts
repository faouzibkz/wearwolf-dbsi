import { randomUUID } from "node:crypto";
import type { GameConfig } from "@loupgarou/shared";
import { GameEngine } from "@loupgarou/game-engine";

/**
 * Holds every active game, in memory, for the lifetime of the process.
 * There's no shared admin password anymore — anyone can create a game, and
 * whoever does becomes its host via a random per-game `hostToken`, handed
 * only to their own client and required to resume as host later (e.g.
 * after a page refresh). This is the exact same pattern as each player's
 * own `reconnectToken` (see GameEngine.addPlayer), just for the host seat
 * instead of a player seat — knowing a game's code is enough to JOIN it,
 * but only knowing its hostToken lets you administer it.
 */
class GameRegistry {
  private games = new Map<string, GameEngine>();
  private adminSocketByCode = new Map<string, string>();
  private hostTokenByCode = new Map<string, string>();
  /**
   * Which account (User.id) is behind each live engine player id. Kept
   * entirely here, in memory, server-side only — deliberately NOT stored on
   * GameEngine's own InternalPlayer, so the account/stats layer stays fully
   * decoupled from the (separately tested, framework-agnostic) game engine
   * package. Populated on PLAYER_JOIN/PLAYER_RECONNECT, consumed once by
   * finalizeGameHistory() at GAME_ENDED. Player ids are globally unique
   * (see util/ids.ts), so one flat map across all games is fine.
   */
  private userIdByPlayerId = new Map<string, string>();

  create(config: Partial<GameConfig>): { engine: GameEngine; hostToken: string } {
    const engine = GameEngine.createGame(config);
    this.games.set(engine.getCode(), engine);
    const hostToken = randomUUID();
    this.hostTokenByCode.set(engine.getCode(), hostToken);
    return { engine, hostToken };
  }

  isValidHostToken(code: string, hostToken: string | undefined): boolean {
    if (!hostToken) return false;
    return this.hostTokenByCode.get(code.toUpperCase()) === hostToken;
  }

  get(code: string): GameEngine | undefined {
    return this.games.get(code.toUpperCase());
  }

  requireGame(code: string): GameEngine {
    const engine = this.get(code);
    if (!engine) throw new Error("Partie introuvable.");
    return engine;
  }

  setAdminSocket(code: string, socketId: string): void {
    this.adminSocketByCode.set(code.toUpperCase(), socketId);
  }

  getAdminSocket(code: string): string | undefined {
    return this.adminSocketByCode.get(code.toUpperCase());
  }

  isAdminSocket(code: string, socketId: string): boolean {
    return this.adminSocketByCode.get(code.toUpperCase()) === socketId;
  }

  all(): GameEngine[] {
    return [...this.games.values()];
  }

  setPlayerUserId(playerId: string, userId: string): void {
    this.userIdByPlayerId.set(playerId, userId);
  }

  getPlayerUserId(playerId: string): string | undefined {
    return this.userIdByPlayerId.get(playerId);
  }

  /**
   * Does this account already have a live seat in this specific game?
   * Backs PLAYER_JOIN's account-based reconnect (closed tab, new device,
   * re-scanned QR code — doesn't matter which): if the answer is yes, the
   * handler resumes that seat instead of erroring on a taken nickname or
   * creating a duplicate ghost player. Scoped to one engine's own roster
   * (not the flat cross-game userIdByPlayerId map) since the same account
   * could in principle be a player in more than one open game at once.
   */
  findPlayerIdForUser(engine: GameEngine, userId: string): string | undefined {
    for (const player of engine.getPlayers()) {
      if (this.userIdByPlayerId.get(player.id) === userId) return player.id;
    }
    return undefined;
  }

  /** Called once history is durably written for a game, so this map doesn't grow forever across a long-running process. */
  clearPlayerUserIds(playerIds: string[]): void {
    for (const id of playerIds) {
      this.userIdByPlayerId.delete(id);
      this.currentSocketByPlayerId.delete(id);
    }
  }

  /**
   * Which socket.id is THE current live connection for a player — set on
   * every PLAYER_JOIN/PLAYER_RECONNECT. Exists purely to guard the
   * "disconnect" handler against a race: if account X reconnects from a
   * new tab/device while an old, stale tab is still hanging around, that
   * old tab's eventual "disconnect" event must not flip the player back to
   * disconnected after the new tab already took over — only the socket
   * that's still the CURRENT one for this player is allowed to do that
   * (see socket/handlers.ts's "disconnect" handler).
   */
  private currentSocketByPlayerId = new Map<string, string>();

  setCurrentSocket(playerId: string, socketId: string): void {
    this.currentSocketByPlayerId.set(playerId, socketId);
  }

  isCurrentSocket(playerId: string, socketId: string): boolean {
    return this.currentSocketByPlayerId.get(playerId) === socketId;
  }
}

export const gameRegistry = new GameRegistry();
