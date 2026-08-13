import { mvpVotingRegistry } from "../mvp/mvpVotingRegistry.js";

/**
 * Safety-net auto-finalize for the post-game MVP vote (see
 * mvp/mvpVotingRegistry.ts and TimerConfig.mvpVote's own doc comment).
 * Deliberately its own tiny module, separate from socket/timers.ts's phase
 * timer: MVP voting happens entirely AFTER the engine's phase reaches
 * "ENDED" (see handlers.ts's sync()), so it has no `Phase` to key off of,
 * no pause/autoProgress concept, and no per-speaker/per-step fingerprinting
 * to worry about — just one flat deadline per game code, set once when
 * voting opens and cleared once it's finalized (by any path).
 */
const mvpTimers = new Map<string, NodeJS.Timeout>();

export function clearMvpVoteTimer(code: string): void {
  const t = mvpTimers.get(code);
  if (t) {
    clearTimeout(t);
    mvpTimers.delete(code);
  }
}

/**
 * Called once, right after mvpVotingRegistry.open() (see handlers.ts's
 * sync()). `deadlineAt` is that same call's own recorded
 * state.deadlineAt — passing it through (rather than re-deriving a fresh
 * duration here) guarantees this setTimeout fires at EXACTLY the instant
 * already broadcast to clients via MvpStatePayload.deadlineAt, the same
 * "anchor to the already-established deadline" discipline socket/timers.ts
 * uses for every other timer in this app.
 *
 * No-ops entirely if `deadlineAt` is null (duration 0/negative — safety
 * net disabled for this game): voting then waits forever for everyone, or
 * an admin's manual ADMIN_FORCE_MVP_FINALIZE, exactly like before this
 * feature existed.
 *
 * Safe against every race: if every player votes first, MVP_VOTE_CAST's
 * own isComplete() check finalizes and clears this timer, so it never
 * fires. If it fires anyway (a stray timing edge case), it checks
 * `finalized` itself before calling `onDeadline` — finalize() is also
 * independently idempotent — so a double-finalize can never produce two
 * different results or double-award XP/badges.
 */
export function scheduleMvpVoteTimer(
  code: string,
  deadlineAt: number | null,
  onDeadline: () => void,
): void {
  clearMvpVoteTimer(code);
  if (deadlineAt === null) return;

  const delayMs = Math.max(0, deadlineAt - Date.now());
  const timeout = setTimeout(() => {
    mvpTimers.delete(code);
    try {
      const state = mvpVotingRegistry.getState(code);
      if (!state || state.finalized) return; // already finalized naturally, or the game/registry was cleared
      onDeadline();
    } catch (err) {
      console.error("[mvp-timer] auto-finalize failed", err);
    }
  }, delayMs);

  mvpTimers.set(code, timeout);
}
