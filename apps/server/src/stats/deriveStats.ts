/**
 * Pure, Prisma-free stat calculations (Phase 2a — cahier de charge section
 * 4's second and third stat tiers). Deliberately separated from
 * db/persistence.ts: everything in this file takes and returns plain
 * objects/primitives, so it can be unit tested directly (see
 * deriveStats.test.ts) without a database, without Prisma's generated
 * client, and without ever touching the game engine. persistence.ts's
 * getUserAggregateStats() is the only caller — it fetches rows, hands them
 * here, and returns whatever comes back.
 */

export type GameResult = "WON" | "LOST" | "DRAW" | null;

// --- Per-role breakdown (moved here unchanged from the original inline
// Map-based implementation in persistence.ts — same behavior, now testable
// in isolation). Entirely generic: it groups by whatever roleId strings
// actually appear in `records`, so a brand new role added to the game
// starts showing up here automatically, per spec section 16. ---

export interface RoleResultRow {
  roleId: string;
  result: GameResult;
}

export interface AggregateRoleStat {
  roleId: string;
  games: number;
  wins: number;
  losses: number;
  winRate: number;
}

export function computePerRoleStats(records: RoleResultRow[]): AggregateRoleStat[] {
  const perRoleMap = new Map<string, { games: number; wins: number; losses: number }>();
  for (const r of records) {
    const bucket = perRoleMap.get(r.roleId) ?? { games: 0, wins: 0, losses: 0 };
    bucket.games += 1;
    if (r.result === "WON") bucket.wins += 1;
    if (r.result === "LOST") bucket.losses += 1;
    perRoleMap.set(r.roleId, bucket);
  }
  return [...perRoleMap.entries()]
    .map(([roleId, b]) => ({
      roleId,
      games: b.games,
      wins: b.wins,
      losses: b.losses,
      winRate: b.games > 0 ? b.wins / b.games : 0,
    }))
    .sort((a, b) => b.games - a.games);
}

// --- Win streaks. "Current" = the run of consecutive wins ending at the
// most recent game only (a single loss anywhere after the last win resets
// it to 0); "longest" = the best run anywhere in the account's history. ---

export interface StreakRow {
  result: GameResult;
  /** epoch ms — anything monotonic and comparable works (game.endedAt ?? game.createdAt). */
  playedAt: number;
}

export function computeWinStreaks(records: StreakRow[]): { current: number; longest: number } {
  const sorted = [...records].sort((a, b) => a.playedAt - b.playedAt);

  let longest = 0;
  let running = 0;
  for (const r of sorted) {
    if (r.result === "WON") {
      running += 1;
      longest = Math.max(longest, running);
    } else {
      running = 0;
    }
  }

  let current = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].result === "WON") current += 1;
    else break;
  }

  return { current, longest };
}

// --- Average nights survived. Interpretation (documented explicitly since
// the cahier de charge doesn't spell out the exact formula for "Average
// Survival"): how many full night phases a player was alive for in a given
// game, derived from deathMoment ("Nuit N" / "Jour N", set by
// packages/game-engine's DeathQueue) and the game's finalNightNumber
// snapshot (see schema.prisma). Dying during "Nuit N" means the player
// survived nights 1..N-1 fully (N-1); dying during "Jour N" means he
// survived night N fully before dying the following day (N); a survivor
// gets full credit for the game's total night count. ---

export interface SurvivalRow {
  isAlive: boolean;
  deathMoment: string | null;
  finalNightNumber: number;
}

const DEATH_MOMENT_RE = /^(Nuit|Jour) (\d+)$/;

export function nightsSurvived(row: SurvivalRow): number {
  if (row.isAlive) return Math.max(0, row.finalNightNumber);
  const match = row.deathMoment?.match(DEATH_MOMENT_RE);
  if (!match) return 0;
  const n = Number(match[2]);
  return match[1] === "Nuit" ? Math.max(0, n - 1) : Math.max(0, n);
}

export function averageNightsSurvived(rows: SurvivalRow[]): number {
  if (rows.length === 0) return 0;
  const total = rows.reduce((sum, r) => sum + nightsSurvived(r), 0);
  return total / rows.length;
}

// --- Death-cause breakdown (spec section 4, third tier). deathCause values
// come from packages/game-engine/src/engine/DeathQueue.ts — categorizing a
// fixed, small set of engine-level death causes here is NOT the kind of
// role-branching the architecture principle (section 16) forbids; it's the
// stats feature the cahier de charge explicitly asks for. ---

const WOLF_DEATH_CAUSES = new Set(["LOUP_GAROU_ATTACK", "LOUP_BLANC_ATTACK"]);

export interface DeathBreakdownRow {
  deathMoment: string | null;
  deathCause: string | null;
  isAlive: boolean;
}

export interface DeathBreakdown {
  firstNightDeaths: number;
  killedByWolves: number;
  executedByVillage: number;
  survivedUntilEnd: number;
}

export function computeDeathBreakdown(rows: DeathBreakdownRow[]): DeathBreakdown {
  return {
    firstNightDeaths: rows.filter((r) => r.deathMoment === "Nuit 1").length,
    killedByWolves: rows.filter((r) => r.deathCause !== null && WOLF_DEATH_CAUSES.has(r.deathCause)).length,
    executedByVillage: rows.filter((r) => r.deathCause === "VOTE_ELIMINATION").length,
    survivedUntilEnd: rows.filter((r) => r.isAlive).length,
  };
}
