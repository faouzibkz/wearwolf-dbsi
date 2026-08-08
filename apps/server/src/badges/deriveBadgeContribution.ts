import type { FinalPlayerSummary, GameEvent, Team } from "@loupgarou/shared";
import { ROLE_METADATA } from "@loupgarou/shared";

/**
 * Pure, Prisma-free (same split as ../stats/deriveStats.ts): everything
 * here takes plain data and returns plain data, so it's unit-testable
 * without a database or the game engine. db/persistence.ts's
 * finalizeGameHistory() is the only caller — it hands this ONE player's own
 * events (see GameEngine.getPlayerEvents()) for THIS game, gets back their
 * contribution to the badge career totals, and persists it on that
 * player's PlayerRecord row (see schema.prisma's new columns). Later,
 * badges/applyBadges.ts SUMs these across a user's whole PlayerRecord
 * history to evaluate the role-mastery badges — cheap, and never needs to
 * re-parse a historical Game.stateJson blob.
 */
export interface BadgeContribution {
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
}

/**
 * `events` is this player's own actions (GameEvent.actorId === them);
 * `fullEventLog` is the whole game's log, needed only for Corbeau (a
 * DAY_VOTE_ELIMINATION has no actorId, so "did my mark actually get this
 * player eliminated the next day" can never appear in `events` alone —
 * same reasoning as packages/rating's corbeauPerformanceScore).
 */
export function deriveBadgeContribution(events: GameEvent[], fullEventLog: GameEvent[]): BadgeContribution {
  const contribution: BadgeContribution = {
    voyanteWolvesFound: 0,
    salvateurSuccessfulProtects: 0,
    sorciereWolvesKilledByPoison: 0,
    chasseurWolvesKilledByShot: 0,
    alienCorrectGuesses: 0,
    loupVertSuccessfulSteals: 0,
    corbeauSuccessfulMarks: 0,
    barbieWolvesRevealed: 0,
    barbieMisfires: 0,
    mowgliTransformed: false,
  };

  const marks: Extract<GameEvent, { type: "CORBEAU_MARK" }>[] = [];

  for (const e of events) {
    switch (e.type) {
      case "VOYANTE_INSPECT":
        if (e.result === "LOUP") contribution.voyanteWolvesFound += 1;
        break;
      case "SALVATEUR_PROTECT":
        if (e.saved) contribution.salvateurSuccessfulProtects += 1;
        break;
      case "SORCIERE_POISON":
        if (e.killedWolf) contribution.sorciereWolvesKilledByPoison += 1;
        break;
      case "CHASSEUR_SHOT":
        if (ROLE_METADATA[e.targetRoleId].team === "LOUPS") contribution.chasseurWolvesKilledByShot += 1;
        break;
      case "ALIEN_GUESS":
        if (e.correct) contribution.alienCorrectGuesses += 1;
        break;
      case "LOUP_VERT_GUESS":
        if (e.correct) contribution.loupVertSuccessfulSteals += 1;
        break;
      case "BARBIE_REVEAL":
        if (e.outcome === "WOLF_DIED_BARBIE_CHEF") contribution.barbieWolvesRevealed += 1;
        else contribution.barbieMisfires += 1;
        break;
      case "MOWGLI_TRANSFORM":
        contribution.mowgliTransformed = true;
        break;
      case "CORBEAU_MARK":
        marks.push(e);
        break;
      default:
        break;
    }
  }

  if (marks.length > 0) {
    const eliminations = fullEventLog.filter(
      (e): e is Extract<GameEvent, { type: "DAY_VOTE_ELIMINATION" }> => e.type === "DAY_VOTE_ELIMINATION",
    );
    contribution.corbeauSuccessfulMarks = marks.filter((m) =>
      eliminations.some((elim) => elim.day === m.night + 1 && elim.targetId === m.targetId),
    ).length;
  }

  return contribution;
}

/**
 * "Dernier Debout" — true only for the sole surviving member of the
 * WINNING team (a draw, a loss, or surviving alongside teammates all don't
 * qualify). Deliberately excludes SOLO (the Alien never appears as
 * `winner` — see VictoryConditions.ts — so this can never accidentally
 * fire for him).
 */
export function wasSoleSurvivor(
  summary: FinalPlayerSummary,
  allSummaries: FinalPlayerSummary[],
  winner: Team | null,
): boolean {
  if (!winner || !summary.isAlive || summary.team !== winner) return false;
  const aliveOnWinningTeam = allSummaries.filter((s) => s.isAlive && s.team === winner);
  return aliveOnWinningTeam.length === 1 && aliveOnWinningTeam[0]!.playerId === summary.playerId;
}
