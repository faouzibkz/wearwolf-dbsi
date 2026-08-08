import type { GameEngine } from "@loupgarou/game-engine";
import { prisma } from "./prisma.js";
import {
  averageNightsSurvived,
  computeDeathBreakdown,
  computePerRoleStats,
  computeWinStreaks,
  type GameResult,
} from "../stats/deriveStats.js";
import { deriveBadgeContribution, wasSoleSurvivor } from "../badges/deriveBadgeContribution.js";

/**
 * Best-effort snapshot persistence. Every mutating socket handler calls
 * `persistGame(engine)` after it changes state; failures are logged but
 * never thrown, so a database outage degrades to "no crash-resilience"
 * rather than "game stops working".
 */
export async function persistGame(engine: GameEngine): Promise<void> {
  try {
    const serialized = engine.serialize() as Record<string, unknown>;
    const ended = engine.getPhase() === "ENDED";
    // Snapshot how far the game got (see schema.prisma's Game.finalNightNumber
    // doc comment) only once, at the moment it actually ends - reading these
    // off getPublicState() while the game is still in progress would just be
    // "however far it's gotten so far", which isn't what "final" means here.
    const publicState = engine.getPublicState();
    await prisma.game.upsert({
      where: { code: engine.getCode() },
      create: {
        code: engine.getCode(),
        name: engine.getConfig().name,
        phase: engine.getPhase(),
        configJson: engine.getConfig() as object,
        stateJson: serialized as object,
      },
      update: {
        phase: engine.getPhase(),
        configJson: engine.getConfig() as object,
        stateJson: serialized as object,
        endedAt: ended ? new Date() : undefined,
        winner: publicState.winner,
        finalNightNumber: ended ? publicState.nightNumber : undefined,
        finalDayNumber: ended ? publicState.dayNumber : undefined,
      },
    });
  } catch (err) {
    console.error("[persistence] failed to persist game", engine.getCode(), err);
  }
}

/**
 * Writes one PlayerRecord row per player, once, when a game ends (see
 * socket/handlers.ts's `sync()` — called from the same one-shot
 * `consumeGameEndedNotification()` branch that fires the GAME_ENDED socket
 * event). This is what actually turns "a finished game" into durable,
 * queryable history/stats (section 4/5 of the accounts spec) — before this,
 * PlayerRecord existed in the schema but nothing ever wrote to it.
 *
 * `userIdForPlayer` is a plain lookup function rather than a Map so the
 * caller (handlers.ts) can source it from gameRegistry without this module
 * needing to know anything about how that mapping is maintained — keeps the
 * account-linkage bookkeeping and the DB write fully decoupled.
 *
 * Best-effort, like persistGame(): a DB hiccup here must never crash or
 * hang the game for the people still looking at the end screen.
 */
export async function finalizeGameHistory(
  engine: GameEngine,
  userIdForPlayer: (playerId: string) => string | undefined,
): Promise<void> {
  try {
    const game = await prisma.game.findUnique({ where: { code: engine.getCode() } });
    if (!game) {
      // persistGame() always upserts the Game row before this runs (see
      // sync() ordering in handlers.ts) — this should be unreachable, but
      // there's nothing to attach PlayerRecord rows to if it somehow is.
      console.error("[history] no Game row found for", engine.getCode(), "— skipping history write");
      return;
    }

    const winner = engine.getPublicState().winner;
    const summaries = engine.getFinalPlayerSummaries();
    // Cahier de charge #2 §17.4c — read once, shared by every player below
    // (a Corbeau's mark can only be checked against the full log, not that
    // player's own events alone — see deriveBadgeContribution.ts).
    const fullEventLog = engine.getEventLog();

    await Promise.all(
      summaries.map((s) => {
        const result = winner === null ? "DRAW" : s.team === winner ? "WON" : "LOST";
        const contribution = deriveBadgeContribution(engine.getPlayerEvents(s.playerId), fullEventLog);
        const soleSurvivor = wasSoleSurvivor(s, summaries, winner);
        return prisma.playerRecord.upsert({
          where: { gameId_enginePlayerId: { gameId: game.id, enginePlayerId: s.playerId } },
          create: {
            gameId: game.id,
            enginePlayerId: s.playerId,
            nickname: s.nickname,
            roleId: s.roleId,
            isAlive: s.isAlive,
            deathCause: s.deathCause,
            deathMoment: s.deathMoment,
            team: s.team,
            result,
            userId: userIdForPlayer(s.playerId) ?? null,
            ...contribution,
            wasSoleSurvivor: soleSurvivor,
          },
          update: {
            nickname: s.nickname,
            roleId: s.roleId,
            isAlive: s.isAlive,
            deathCause: s.deathCause,
            deathMoment: s.deathMoment,
            team: s.team,
            result,
            userId: userIdForPlayer(s.playerId) ?? null,
            ...contribution,
            wasSoleSurvivor: soleSurvivor,
          },
        });
      }),
    );
  } catch (err) {
    console.error("[history] failed to finalize game history for", engine.getCode(), err);
  }
}

/**
 * Minimum stats set from section 4 of the spec (games/wins/losses/win-rate)
 * plus the per-role breakdown — computed on the fly from PlayerRecord rows
 * rather than cached, which is plenty fast at this scale and means there's
 * no separate cache to keep in sync. Deliberately generic: it groups by
 * whatever `roleId` strings actually show up in the data, so a brand new
 * role shows up here automatically the first time anyone plays it — no
 * code change required (see spec section 16).
 */
interface AggregateStatsRow {
  roleId: string;
  result: GameResult;
  isAlive: boolean;
  deathCause: string | null;
  deathMoment: string | null;
  game: { createdAt: Date; endedAt: Date | null; finalNightNumber: number };
}

/**
 * Section 4's full stat set (minimum tier + the two tiers added in Phase
 * 2a). The actual math for streaks/survival/death-breakdown lives in
 * ../stats/deriveStats.ts as plain, Prisma-free functions — this function's
 * only job is fetching the rows and handing them over, so the calculations
 * themselves stay unit-testable without a database.
 */
export async function getUserAggregateStats(userId: string) {
  const records: AggregateStatsRow[] = await prisma.playerRecord.findMany({
    where: { userId },
    select: {
      roleId: true,
      result: true,
      isAlive: true,
      deathCause: true,
      deathMoment: true,
      game: { select: { createdAt: true, endedAt: true, finalNightNumber: true } },
    },
  });

  const gamesPlayed = records.length;
  const gamesWon = records.filter((r) => r.result === "WON").length;
  const gamesLost = records.filter((r) => r.result === "LOST").length;
  const winRate = gamesPlayed > 0 ? gamesWon / gamesPlayed : 0;

  const perRole = computePerRoleStats(records);

  // "Chronological" for streak purposes = when the game actually ended
  // (falling back to createdAt for the rare in-progress/legacy row where
  // endedAt is still null — shouldn't happen for a row with a non-null
  // `result`, but keeps this from ever throwing on unexpected data).
  const streaks = computeWinStreaks(
    records.map((r) => ({ result: r.result, playedAt: (r.game.endedAt ?? r.game.createdAt).getTime() })),
  );

  const avgNightsSurvived = averageNightsSurvived(
    records.map((r) => ({ isAlive: r.isAlive, deathMoment: r.deathMoment, finalNightNumber: r.game.finalNightNumber })),
  );

  const deathBreakdown = computeDeathBreakdown(records);

  return {
    gamesPlayed,
    gamesWon,
    gamesLost,
    winRate,
    perRole,
    currentWinStreak: streaks.current,
    longestWinStreak: streaks.longest,
    averageNightsSurvived: avgNightsSurvived,
    ...deathBreakdown,
  };
}

interface HistoryRow {
  nickname: string;
  roleId: string;
  team: string | null;
  result: string | null;
  isAlive: boolean;
  deathCause: string | null;
  deathMoment: string | null;
  game: {
    id: string;
    code: string;
    name: string;
    createdAt: Date;
    endedAt: Date | null;
    winner: string | null;
    _count: { players: number };
  };
}

/** Paginated match history (section 5) — newest first. */
export async function getUserGameHistory(userId: string, { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {}) {
  const [records, total]: [HistoryRow[], number] = await Promise.all([
    prisma.playerRecord.findMany({
      where: { userId },
      include: { game: { include: { _count: { select: { players: true } } } } },
      orderBy: { joinedAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.playerRecord.count({ where: { userId } }),
  ]);

  return {
    total,
    games: records.map((r) => ({
      gameId: r.game.id,
      code: r.game.code,
      name: r.game.name,
      playedAt: (r.game.endedAt ?? r.game.createdAt).toISOString(),
      playerCount: r.game._count.players,
      nickname: r.nickname,
      roleId: r.roleId,
      team: r.team,
      result: r.result as "WON" | "LOST" | "DRAW" | null,
      isAlive: r.isAlive,
      deathCause: r.deathCause,
      deathMoment: r.deathMoment,
      winner: r.game.winner,
    })),
  };
}

// --- Leaderboards (cahier de charge #2 §17.4e) ---
//
// Section 14's own note turned out true: "aucune donnée manquante, tout
// existe déjà" — every category here reads straight off User (rating/XP/
// MVP, already incrementally maintained by applyRating.ts/
// applyProgression.ts) or a simple aggregate over PlayerRecord (wins), the
// same "already in the DB, just needs a query" pattern as
// getUserAggregateStats above.

export const LEADERBOARD_CATEGORIES = [
  "RATING_GLOBAL",
  "RATING_VILLAGE",
  "RATING_WOLF",
  "RATING_SOLO",
  "XP",
  "WINS",
  "MVP",
] as const;
export type LeaderboardCategory = (typeof LEADERBOARD_CATEGORIES)[number];

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  value: number;
}

/** Every category except WINS is a straight "sort User by this column" — WINS needs an aggregate over PlayerRecord instead, no single column for it exists on User. */
const USER_SORT_FIELD: Partial<Record<LeaderboardCategory, string>> = {
  RATING_GLOBAL: "ratingGlobal",
  RATING_VILLAGE: "ratingVillage",
  RATING_WOLF: "ratingWolf",
  RATING_SOLO: "ratingSolo",
  XP: "totalXp",
  MVP: "mvpCount",
};

export async function getLeaderboard(category: LeaderboardCategory, limit = 20): Promise<LeaderboardEntry[]> {
  if (category === "WINS") {
    const grouped: { userId: string | null; _count: { userId: number } }[] = await prisma.playerRecord.groupBy({
      by: ["userId"],
      where: { result: "WON", userId: { not: null } },
      _count: { userId: true },
      orderBy: { _count: { userId: "desc" } },
      take: limit,
    });
    const userIds = grouped.map((g) => g.userId).filter((id): id is string => Boolean(id));
    if (userIds.length === 0) return [];
    const users: { id: string; displayName: string }[] = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, displayName: true },
    });
    const nameById = new Map(users.map((u) => [u.id, u.displayName]));
    return grouped
      .filter((g): g is typeof g & { userId: string } => Boolean(g.userId))
      .map((g, i) => ({ rank: i + 1, userId: g.userId, displayName: nameById.get(g.userId) ?? "?", value: g._count.userId }));
  }

  const field = USER_SORT_FIELD[category];
  if (!field) return [];
  const users: Record<string, unknown>[] = await prisma.user.findMany({
    orderBy: { [field]: "desc" },
    take: limit,
    select: { id: true, displayName: true, [field]: true },
  });
  return users.map((u, i) => ({
    rank: i + 1,
    userId: u.id as string,
    displayName: u.displayName as string,
    value: Math.round(u[field] as number),
  }));
}

export async function listPresets() {
  return prisma.preset.findMany({ orderBy: { updatedAt: "desc" } });
}

export async function savePreset(name: string, configJson: object) {
  return prisma.preset.upsert({
    where: { name },
    create: { name, configJson },
    update: { configJson },
  });
}
