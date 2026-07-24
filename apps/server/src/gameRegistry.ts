import type { GameConfig } from "@loupgarou/shared";
import { GameEngine } from "@loupgarou/game-engine";

/**
 * Holds every active game, in memory, for the lifetime of the process. One
 * admin secret can control multiple concurrent games (each with its own
 * code) — handy for testing — but the spec's "only one administrator"
 * constraint is enforced per-game via `adminSocketId`.
 */
class GameRegistry {
  private games = new Map<string, GameEngine>();
  private adminSocketByCode = new Map<string, string>();

  create(config: Partial<GameConfig>): GameEngine {
    const engine = GameEngine.createGame(config);
    this.games.set(engine.getCode(), engine);
    return engine;
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
