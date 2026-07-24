import type { GameConfig } from "@loupgarou/shared";
import { GameEngine } from "../engine/GameEngine";

/** Deterministic PRNG (mulberry32) so role-assignment tests are reproducible. */
export function seededRng(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeGameWithPlayers(
  nicknames: string[],
  configOverrides: Partial<GameConfig> = {},
  seed = 42,
): { engine: GameEngine; playerIds: Record<string, string> } {
  const engine = GameEngine.createGame(
    {
      roleCounts: { LOUP_GAROU: 1, VOYANTE: 1 },
      ...configOverrides,
    },
    seededRng(seed),
  );
  const playerIds: Record<string, string> = {};
  for (const nickname of nicknames) {
    const player = engine.addPlayer(nickname);
    playerIds[nickname] = player.id;
  }
  return { engine, playerIds };
}
