import { tallyMvpVotes } from "./tallyMvpVotes.js";

interface MvpVoteState {
  /** Every player who was actually in this game — both who may vote and who may be voted for. */
  eligiblePlayerIds: Set<string>;
  /** voterId -> votedForId. */
  votes: Map<string, string>;
  finalized: boolean;
  /** Set once finalized; empty if finalized with zero votes cast. */
  winners: string[];
}

/**
 * In-memory MVP voting state, one entry per game, keyed by game code —
 * same pattern as gameRegistry's own per-game maps, kept in its own module
 * since MVP voting is a self-contained concern with no reason to live
 * inside GameRegistry itself.
 *
 * Deliberately holds NO account/Prisma knowledge at all: it only ever
 * talks in terms of the game engine's own playerIds. Resolving those to
 * accounts (to actually award XP/mvpCount) happens later, in
 * progression/applyProgression.ts, via the PlayerRecord rows
 * finalizeGameHistory already wrote — not via this registry.
 */
class MvpVotingRegistry {
  private stateByGameCode = new Map<string, MvpVoteState>();

  /** Called once, right when GAME_ENDED fires (see socket/handlers.ts's sync()). Safe to call again for the same code (e.g. a stray double-emit) — it just resets voting. */
  open(gameCode: string, eligiblePlayerIds: string[]): void {
    this.stateByGameCode.set(gameCode, {
      eligiblePlayerIds: new Set(eligiblePlayerIds),
      votes: new Map(),
      finalized: false,
      winners: [],
    });
  }

  /** Throws on any invalid vote (not open, already finalized, unknown voter/target, self-vote, or a repeat vote from the same voter overwrites their previous choice rather than erroring — matches how every other single-choice vote in this app behaves, e.g. VoteManager.castDayVote). */
  castVote(gameCode: string, voterId: string, votedForId: string): MvpVoteState {
    const state = this.stateByGameCode.get(gameCode);
    if (!state) throw new Error("Le vote MVP n'est pas ouvert pour cette partie.");
    if (state.finalized) throw new Error("Le vote MVP est déjà terminé pour cette partie.");
    if (!state.eligiblePlayerIds.has(voterId)) throw new Error("Vous n'avez pas participé à cette partie.");
    if (!state.eligiblePlayerIds.has(votedForId)) throw new Error("Joueur invalide pour ce vote.");
    if (voterId === votedForId) throw new Error("Vous ne pouvez pas voter pour vous-même.");
    state.votes.set(voterId, votedForId);
    return state;
  }

  getState(gameCode: string): MvpVoteState | undefined {
    return this.stateByGameCode.get(gameCode);
  }

  /** True once every eligible player has cast a vote — the "no fixed deadline, wait for everyone" rule. */
  isComplete(gameCode: string): boolean {
    const state = this.stateByGameCode.get(gameCode);
    if (!state) return false;
    return state.votes.size >= state.eligiblePlayerIds.size;
  }

  /** Idempotent: calling this again after it's already finalized just returns the same result, never re-tallies. */
  finalize(gameCode: string): MvpVoteState {
    const state = this.stateByGameCode.get(gameCode);
    if (!state) throw new Error("Le vote MVP n'est pas ouvert pour cette partie.");
    if (!state.finalized) {
      state.winners = tallyMvpVotes(Object.fromEntries(state.votes));
      state.finalized = true;
    }
    return state;
  }

  /** Frees the memory once a game's result has been persisted — mirrors gameRegistry.clearPlayerUserIds. */
  clear(gameCode: string): void {
    this.stateByGameCode.delete(gameCode);
  }
}

export const mvpVotingRegistry = new MvpVotingRegistry();
