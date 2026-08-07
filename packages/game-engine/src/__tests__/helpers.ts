import type { GameConfig } from "@loupgarou/shared";
import { GameEngine } from "../engine/GameEngine";
import type { DayVoteOutcome } from "../engine/VoteManager";

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

/**
 * Walks the DAY_VOTE per-player turn queue in order, casting (or skipping)
 * each voter's turn per `votesByVoterId` (voterId -> targetId). A voter
 * missing from the map has their turn skipped (mirroring a timeout — no
 * vote recorded), same as GameEngine.skipCurrentDayVoter(). Casting/skipping
 * the LAST turn auto-triggers the tally internally (see
 * GameEngine.advanceDayVoteQueue()), so callers don't need to call
 * tallyDayVoteAndProceed() themselves — by the time this returns, the
 * round has already been tallied and the engine has moved on (NIGHT,
 * TIE_DEFENSE, DAY_VOTE_RESULT, manual-resolution parking, etc.).
 *
 * Replaces the old pattern of calling `engine.castDayVote()` for players in
 * arbitrary order followed by a manual `engine.tallyDayVoteAndProceed()` —
 * that pattern no longer works now that votes are turn-enforced, and the
 * tally now happens automatically as a side effect of the last turn.
 *
 * Returns the DayVoteOutcome from that automatic tally (or null if the
 * queue was already empty / not in DAY_VOTE, e.g. called by mistake).
 */
export function castDayVotesInOrder(
  engine: GameEngine,
  votesByVoterId: Record<string, string | undefined>,
): DayVoteOutcome | null {
  let lastOutcome: DayVoteOutcome | null = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const voterId = engine.getCurrentDayVoterId();
    if (voterId === null) return lastOutcome; // queue closed (round tallied) or not in DAY_VOTE
    const targetId = votesByVoterId[voterId];
    if (targetId) {
      lastOutcome = engine.castDayVote(voterId, targetId);
    } else {
      lastOutcome = engine.skipCurrentDayVoter().outcome;
    }
  }
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
