import type { Team } from "@loupgarou/shared";
import type { EngineContext } from "../internalTypes";

/**
 * A victory condition inspects the current state and returns a winning
 * team, or null if the game continues. Conditions are evaluated in order;
 * the first non-null result wins. Add new conditions to `VICTORY_CONDITIONS`
 * below without touching GameEngine.
 */
export type VictoryCondition = (ctx: EngineContext) => Team | null;

const villageEliminatesAllWolves: VictoryCondition = (ctx) => {
  const aliveWolves = ctx.getAlivePlayers().filter((p) => p.roleId === "LOUP_GAROU" || p.roleId === "LOUP_BLANC");
  const alivePlayers = ctx.getAlivePlayers();
  if (alivePlayers.length > 0 && aliveWolves.length === 0) return "VILLAGE";
  return null;
};

const wolvesReachParity: VictoryCondition = (ctx) => {
  const alive = ctx.getAlivePlayers();
  const aliveWolves = alive.filter((p) => p.roleId === "LOUP_GAROU" || p.roleId === "LOUP_BLANC");
  const aliveVillage = alive.length - aliveWolves.length;
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
