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
}

export const gameRegistry = new GameRegistry();
