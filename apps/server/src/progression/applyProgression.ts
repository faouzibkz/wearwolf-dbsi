import type { GameEngine } from "@loupgarou/game-engine";
import { computeBaseGameXp, computeLevel, computeMvpBonusXp } from "./deriveProgression.js";
import { prisma } from "../db/prisma.js";

interface XpUser {
  id: string;
  totalXp: number;
}

/**
 * Base XP (participation + victory — cahier de charge section 11). Called
 * once per finished game, right alongside finalizeGameHistory/
 * applyRatingUpdates (see socket/handlers.ts's sync()) — same best-effort
 * contract as those: a failure here is logged and swallowed, never allowed
 * to disrupt the end-of-game experience.
 *
 * Deliberately does NOT include the MVP bonus — that's awarded later, once
 * the post-game MVP vote finalizes, by applyMvpBonus() below. The two are
 * independent precisely because MVP voting has no fixed deadline (it waits
 * for every player, or an admin override) while base XP shouldn't have to
 * wait for that to resolve.
 */
export async function applyBaseProgression(
  engine: GameEngine,
  userIdForPlayer: (playerId: string) => string | undefined,
): Promise<void> {
  try {
    const game = await prisma.game.findUnique({ where: { code: engine.getCode() } });
    if (!game) return;

    const winner = engine.getPublicState().winner;
    const summaries = engine.getFinalPlayerSummaries();

    const linked = summaries
      .map((summary) => ({ summary, userId: userIdForPlayer(summary.playerId) }))
      .filter((entry): entry is { summary: (typeof summaries)[number]; userId: string } => Boolean(entry.userId));
    if (linked.length === 0) return;

    const users: XpUser[] = await prisma.user.findMany({
      where: { id: { in: linked.map((l) => l.userId) } },
      select: { id: true, totalXp: true },
    });
    const userById = new Map<string, XpUser>(users.map((u) => [u.id, u]));

    await Promise.all(
      linked.map(async ({ summary, userId }) => {
        const user = userById.get(userId);
        if (!user) return;

        const won = winner !== null && summary.team === winner;
        const xpEarned = computeBaseGameXp(won);
        const newTotalXp = user.totalXp + xpEarned;

        await prisma.$transaction([
          prisma.user.update({
            where: { id: userId },
            data: { totalXp: newTotalXp, level: computeLevel(newTotalXp) },
          }),
          prisma.playerRecord.update({
            where: { gameId_enginePlayerId: { gameId: game.id, enginePlayerId: summary.playerId } },
            data: { xpEarned },
          }),
        ]);
      }),
    );
  } catch (err) {
    console.error("[progression] failed to apply base XP for", engine.getCode(), err);
  }
}

/**
 * MVP bonus XP + mvpCount + PlayerRecord.isMvp (section 12). Called once
 * the MVP vote for a game finalizes (see mvp/mvpVotingRegistry.ts +
 * socket/handlers.ts) — which can happen well after GAME_ENDED, possibly
 * after gameRegistry's in-memory userId map has already been cleared. So,
 * deliberately, this does NOT use that map at all: it resolves each
 * winner's account straight from the PlayerRecord row finalizeGameHistory
 * already wrote (by gameId + enginePlayerId), which is durable and doesn't
 * depend on any in-memory state still being around.
 */
export async function applyMvpBonus(gameCode: string, winnerEnginePlayerIds: string[]): Promise<void> {
  if (winnerEnginePlayerIds.length === 0) return;
  try {
    const game = await prisma.game.findUnique({ where: { code: gameCode } });
    if (!game) return;

    await Promise.all(
      winnerEnginePlayerIds.map(async (enginePlayerId) => {
        const record = await prisma.playerRecord.findUnique({
          where: { gameId_enginePlayerId: { gameId: game.id, enginePlayerId } },
        });
        if (!record || !record.userId) return; // no linked account - nothing to award

        const user: XpUser | null = await prisma.user.findUnique({
          where: { id: record.userId },
          select: { id: true, totalXp: true },
        });
        if (!user) return;

        const bonus = computeMvpBonusXp();
        const newTotalXp = user.totalXp + bonus;

        await prisma.$transaction([
          prisma.user.update({
            where: { id: record.userId },
            data: {
              totalXp: newTotalXp,
              level: computeLevel(newTotalXp),
              mvpCount: { increment: 1 },
            },
          }),
          prisma.playerRecord.update({
            where: { gameId_enginePlayerId: { gameId: game.id, enginePlayerId } },
            data: { isMvp: true, xpEarned: record.xpEarned + bonus },
          }),
        ]);
      }),
    );
  } catch (err) {
    console.error("[progression] failed to apply MVP bonus for", gameCode, err);
  }
}
