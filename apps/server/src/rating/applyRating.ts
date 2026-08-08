import type { GameEngine } from "@loupgarou/game-engine";
import { computePerformanceScore, computeRatingDelta, getRoleDifficulty, specializedScopeForTeam } from "@loupgarou/rating";
import type { RoleId } from "@loupgarou/shared";
import { prisma } from "../db/prisma.js";
import { nightsSurvived } from "../stats/deriveStats.js";

interface RatingUser {
  id: string;
  ratingGlobal: number;
  ratingVillage: number;
  ratingWolf: number;
  ratingSolo: number;
}

interface RoleDifficultyRow {
  roleId: string;
  coefficient: number;
}

/**
 * Rating (cahier de charge sections 6/9/10). Called once per finished game,
 * right alongside finalizeGameHistory (see socket/handlers.ts's sync()) —
 * same best-effort contract as every other DB write triggered by
 * GAME_ENDED: a failure here is logged and swallowed, never allowed to
 * disrupt the end-of-game experience for the people at the table.
 *
 * All the actual rating MATH lives in packages/rating (pure, unit-tested,
 * no database). This function's only job is: gather the rows that math
 * needs, call it once per account-linked player, and persist the result —
 * mirroring the same "thin glue around a pure core" split already used for
 * apps/server/src/stats/deriveStats.ts.
 */
export async function applyRatingUpdates(
  engine: GameEngine,
  userIdForPlayer: (playerId: string) => string | undefined,
): Promise<void> {
  try {
    const game = await prisma.game.findUnique({ where: { code: engine.getCode() } });
    if (!game) return; // same "should be unreachable" note as finalizeGameHistory's identical check

    const winner = engine.getPublicState().winner;
    const summaries = engine.getFinalPlayerSummaries();

    const linked = summaries
      .map((summary) => ({ summary, userId: userIdForPlayer(summary.playerId) }))
      .filter((entry): entry is { summary: (typeof summaries)[number]; userId: string } => Boolean(entry.userId));

    // Nobody in this game had an account linked (shouldn't happen —
    // PLAYER_JOIN requires a session — but never worth crashing over) —
    // nothing to rate.
    if (linked.length === 0) return;

    const users: RatingUser[] = await prisma.user.findMany({
      where: { id: { in: linked.map((l) => l.userId) } },
      select: { id: true, ratingGlobal: true, ratingVillage: true, ratingWolf: true, ratingSolo: true },
    });
    const userById = new Map<string, RatingUser>(users.map((u) => [u.id, u]));
    if (users.length === 0) return;

    // "Rating moyen de la partie" (section 9) — see packages/rating's
    // RatingInputs.avgGameRating doc comment for why this is a game-wide
    // average rather than a per-opponent-team one.
    const avgGameRating = users.reduce((sum: number, u: RatingUser) => sum + u.ratingGlobal, 0) / users.length;

    const roleIds = [...new Set(linked.map((l) => l.summary.roleId))];
    const difficultyRows: RoleDifficultyRow[] = await prisma.roleDifficulty.findMany({ where: { roleId: { in: roleIds } } });
    const overrides: Partial<Record<RoleId, number>> = {};
    for (const row of difficultyRows) overrides[row.roleId as RoleId] = row.coefficient;

    await Promise.all(
      linked.map(async ({ summary, userId }) => {
        const user = userById.get(userId);
        if (!user) return; // shouldn't happen — findMany above was scoped to exactly these ids

        const result = winner === null ? "DRAW" : summary.team === winner ? "WON" : "LOST";
        const won = result === "WON";
        const draw = result === "DRAW";

        const performanceScore = computePerformanceScore({
          summary,
          nightsSurvived: nightsSurvived({
            isAlive: summary.isAlive,
            deathMoment: summary.deathMoment,
            finalNightNumber: game.finalNightNumber,
          }),
          totalNights: game.finalNightNumber,
          won,
          // Cahier de charge #2 §17.4b — real per-role formulas now read
          // this player's own recorded actions (and, for a few roles like
          // Corbeau, the full log) instead of only survival+outcome. See
          // GameEngine.getPlayerEvents()/getEventLog().
          events: engine.getPlayerEvents(summary.playerId),
          fullEventLog: engine.getEventLog(),
        });
        const roleCoefficient = getRoleDifficulty(summary.roleId, overrides);

        const globalUpdate = computeRatingDelta({
          currentRating: user.ratingGlobal,
          avgGameRating,
          won,
          draw,
          performanceScore,
          roleCoefficient,
        });

        const scope = specializedScopeForTeam(summary.team);
        // Deliberately three explicit branches instead of a computed
        // property key — this is the one file in this phase that can't be
        // typechecked in this sandbox (see the commit message), so it's
        // written to be checkable by eye against schema.prisma's exact
        // field names rather than relying on a generic key resolving
        // correctly against Prisma's generated update-input type.
        const userUpdate =
          scope === "VILLAGE"
            ? prisma.user.update({
                where: { id: userId },
                data: {
                  ratingGlobal: globalUpdate.newRating,
                  ratingVillage: computeRatingDelta({
                    currentRating: user.ratingVillage,
                    avgGameRating,
                    won,
                    draw,
                    performanceScore,
                    roleCoefficient,
                  }).newRating,
                },
              })
            : scope === "WOLF"
              ? prisma.user.update({
                  where: { id: userId },
                  data: {
                    ratingGlobal: globalUpdate.newRating,
                    ratingWolf: computeRatingDelta({
                      currentRating: user.ratingWolf,
                      avgGameRating,
                      won,
                      draw,
                      performanceScore,
                      roleCoefficient,
                    }).newRating,
                  },
                })
              : prisma.user.update({
                  where: { id: userId },
                  data: {
                    ratingGlobal: globalUpdate.newRating,
                    ratingSolo: computeRatingDelta({
                      currentRating: user.ratingSolo,
                      avgGameRating,
                      won,
                      draw,
                      performanceScore,
                      roleCoefficient,
                    }).newRating,
                  },
                });

        await prisma.$transaction([
          userUpdate,
          prisma.playerRecord.update({
            where: { gameId_enginePlayerId: { gameId: game.id, enginePlayerId: summary.playerId } },
            data: { ratingDelta: globalUpdate.delta },
          }),
        ]);
      }),
    );
  } catch (err) {
    console.error("[rating] failed to apply rating updates for", engine.getCode(), err);
  }
}

/**
 * Seeds RoleDifficulty from packages/rating's code defaults for any role
 * that doesn't have a row yet — safe to call as often as you like (it only
 * ever creates missing rows, never overwrites a value someone has already
 * tuned). Called once per server boot from index.ts; exported separately
 * (rather than run as a side effect of importing this module) so a future
 * admin endpoint/script could also trigger it deliberately, e.g. right
 * after a brand new role ships.
 */
export async function seedMissingRoleDifficulties(defaults: Partial<Record<RoleId, number>>): Promise<void> {
  const existing: { roleId: string }[] = await prisma.roleDifficulty.findMany({ select: { roleId: true } });
  const existingIds = new Set(existing.map((r: { roleId: string }) => r.roleId));
  const missing = (Object.entries(defaults) as [RoleId, number][]).filter(([roleId]) => !existingIds.has(roleId));
  if (missing.length === 0) return;
  await prisma.roleDifficulty.createMany({
    data: missing.map(([roleId, coefficient]) => ({ roleId, coefficient })),
    skipDuplicates: true,
  });
}
