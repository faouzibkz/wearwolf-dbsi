import { prisma } from "../db/prisma.js";
import { computeWinStreaks, type GameResult } from "../stats/deriveStats.js";
import { evaluateBadges, type BadgeContext } from "./deriveBadges.js";

interface BadgeSourceRow {
  result: string | null;
  voyanteWolvesFound: number;
  salvateurSuccessfulProtects: number;
  sorciereWolvesKilledByPoison: number;
  chasseurWolvesKilledByShot: number;
  alienCorrectGuesses: number;
  loupVertSuccessfulSteals: number;
  corbeauSuccessfulMarks: number;
  barbieWolvesRevealed: number;
  barbieMisfires: number;
  mowgliTransformed: boolean;
  wasSoleSurvivor: boolean;
  game: { createdAt: Date; endedAt: Date | null };
}

function sum(rows: BadgeSourceRow[], key: keyof BadgeSourceRow): number {
  return rows.reduce((total, r) => total + (r[key] as number), 0);
}

/**
 * Re-evaluates every badge for one account and persists whichever ones are
 * newly satisfied — safe to call as often as you like (only ever INSERTs
 * ids not already in UserBadge, never removes one: badges are permanent
 * once earned, same contract as `isSpectator`/deaths elsewhere in this
 * codebase). Called once per finished game (see socket/handlers.ts's
 * sync(), right after finalizeGameHistory/applyRatingUpdates/
 * applyBaseProgression all resolve — those three write the exact
 * PlayerRecord/User columns this reads) AND again whenever a game's MVP
 * vote finalizes (applyMvpBonus increments User.mvpCount well after
 * GAME_ENDED, which the "Populaire" badge depends on) — see
 * applyBadgesForMvpWinners below.
 *
 * Returns the newly-unlocked badge ids (empty if none) — not used for
 * anything yet, but the natural hook for a future "badge unlocked!" toast.
 */
export async function applyBadgesForUser(userId: string): Promise<string[]> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { level: true, mvpCount: true } });
    if (!user) return [];

    const rows: BadgeSourceRow[] = await prisma.playerRecord.findMany({
      where: { userId },
      select: {
        result: true,
        voyanteWolvesFound: true,
        salvateurSuccessfulProtects: true,
        sorciereWolvesKilledByPoison: true,
        chasseurWolvesKilledByShot: true,
        alienCorrectGuesses: true,
        loupVertSuccessfulSteals: true,
        corbeauSuccessfulMarks: true,
        barbieWolvesRevealed: true,
        barbieMisfires: true,
        mowgliTransformed: true,
        wasSoleSurvivor: true,
        game: { select: { createdAt: true, endedAt: true } },
      },
    });

    const streaks = computeWinStreaks(
      rows.map((r) => ({ result: r.result as GameResult, playedAt: (r.game.endedAt ?? r.game.createdAt).getTime() })),
    );

    const ctx: BadgeContext = {
      gamesPlayed: rows.length,
      longestWinStreak: streaks.longest,
      level: user.level,
      mvpCount: user.mvpCount,
      soleSurvivorCount: rows.filter((r) => r.wasSoleSurvivor).length,
      voyanteWolvesFound: sum(rows, "voyanteWolvesFound"),
      salvateurSuccessfulProtects: sum(rows, "salvateurSuccessfulProtects"),
      sorciereWolvesKilledByPoison: sum(rows, "sorciereWolvesKilledByPoison"),
      chasseurWolvesKilledByShot: sum(rows, "chasseurWolvesKilledByShot"),
      alienCorrectGuesses: sum(rows, "alienCorrectGuesses"),
      loupVertSuccessfulSteals: sum(rows, "loupVertSuccessfulSteals"),
      corbeauSuccessfulMarks: sum(rows, "corbeauSuccessfulMarks"),
      barbieWolvesRevealed: sum(rows, "barbieWolvesRevealed"),
      barbieMisfireCount: sum(rows, "barbieMisfires"),
      mowgliTransformCount: rows.filter((r) => r.mowgliTransformed).length,
    };

    const satisfiedIds = evaluateBadges(ctx);
    if (satisfiedIds.length === 0) return [];

    const existing = await prisma.userBadge.findMany({ where: { userId }, select: { badgeId: true } });
    const existingIds = new Set(existing.map((b: { badgeId: string }) => b.badgeId));
    const newIds = satisfiedIds.filter((id) => !existingIds.has(id));
    if (newIds.length === 0) return [];

    await prisma.userBadge.createMany({
      data: newIds.map((badgeId) => ({ userId, badgeId })),
      skipDuplicates: true,
    });
    return newIds;
  } catch (err) {
    console.error("[badges] failed to evaluate badges for", userId, err);
    return [];
  }
}

/**
 * The MVP-vote-finalize trigger for badge re-evaluation. Deliberately
 * mirrors applyProgression.ts's applyMvpBonus: resolves each winner's
 * account straight from the durable PlayerRecord row (by gameId +
 * enginePlayerId), NOT gameRegistry's in-memory map, since MVP voting has
 * no fixed deadline and can finalize well after that map is cleared.
 */
export async function applyBadgesForMvpWinners(gameCode: string, winnerEnginePlayerIds: string[]): Promise<void> {
  if (winnerEnginePlayerIds.length === 0) return;
  try {
    const game = await prisma.game.findUnique({ where: { code: gameCode } });
    if (!game) return;

    const userIds = new Set<string>();
    for (const enginePlayerId of winnerEnginePlayerIds) {
      const record = await prisma.playerRecord.findUnique({
        where: { gameId_enginePlayerId: { gameId: game.id, enginePlayerId } },
        select: { userId: true },
      });
      if (record?.userId) userIds.add(record.userId);
    }
    await Promise.all([...userIds].map((userId) => applyBadgesForUser(userId)));
  } catch (err) {
    console.error("[badges] failed to evaluate MVP-triggered badges for", gameCode, err);
  }
}
