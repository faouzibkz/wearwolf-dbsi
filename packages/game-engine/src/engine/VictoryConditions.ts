import type { Team } from "@loupgarou/shared";
import type { EngineContext, InternalPlayer } from "../internalTypes";

/**
 * A victory condition inspects the current state and returns a winning
 * team, or null if the game continues. Conditions are evaluated in order;
 * the first non-null result wins. Add new conditions to `VICTORY_CONDITIONS`
 * below without touching GameEngine.
 */
export type VictoryCondition = (ctx: EngineContext) => Team | null;

function isWolfRole(p: InternalPlayer): boolean {
  return p.roleId === "LOUP_GAROU" || p.roleId === "LOUP_BLANC" || p.roleId === "LOUP_VERT";
}

/**
 * The Alien is a solo third faction (see roles/alien.ts) — he never wins,
 * and deliberately never counts toward either side's total here, so his
 * presence can't accidentally tip a wolf-parity check or an
 * "all wolves dead" check one way or the other. He's simply invisible to
 * this whole file.
 */
function isAlien(p: InternalPlayer): boolean {
  return p.roleId === "ALIEN";
}

const villageEliminatesAllWolves: VictoryCondition = (ctx) => {
  const aliveWolves = ctx.getAlivePlayers().filter(isWolfRole);
  const aliveNonAlien = ctx.getAlivePlayers().filter((p) => !isAlien(p));
  if (aliveNonAlien.length > 0 && aliveWolves.length === 0) return "VILLAGE";
  return null;
};

const wolvesReachParity: VictoryCondition = (ctx) => {
  const aliveNonAlien = ctx.getAlivePlayers().filter((p) => !isAlien(p));
  const aliveWolves = aliveNonAlien.filter(isWolfRole);
  const aliveVillage = aliveNonAlien.length - aliveWolves.length;
  if (aliveWolves.length > 0 && aliveWolves.length >= aliveVillage) return "LOUPS";
  return null;
};

export const VICTORY_CONDITIONS: VictoryCondition[] = [villageEliminatesAllWolves, wolvesReachParity];

export function checkVictory(ctx: EngineContext): Team | null {
  for (const condition of VICTORY_CONDITIONS) {
    const winner = condition(ctx);
    if (winner) return winner;
  }
  return null;
}

/**
 * True once the Alien is the only player left alive — Village and Loups
 * are both fully eliminated, but the Alien himself never wins (see the
 * module doc comment above). GameEngine checks this alongside
 * checkVictory() so a game can't get stuck open forever in this edge case;
 * it ends the game with no winner instead.
 */
export function isAlienStalemate(ctx: EngineContext): boolean {
  const alive = ctx.getAlivePlayers();
  return alive.length > 0 && alive.every(isAlien);
}
