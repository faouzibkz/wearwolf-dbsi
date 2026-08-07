import type { EngineContext, InternalPlayer, NightActionSubmitted } from "../internalTypes";
import type { NightActionRequest } from "./Role";

/**
 * Shared "pack kill vote" mechanics used by BOTH regular Loup-Garou and the
 * Loup Blanc — every wolf (regardless of exact roleId) shares the same
 * `wolfVotes`/`wolfTargetId` scratch. This is what lets the Loup Blanc keep
 * killing villagers alongside (or after) the rest of the pack, including
 * when he's the only wolf left alive.
 */
export function tallyMajority(votes: Record<string, string>): string | null {
  const counts = new Map<string, number>();
  for (const targetId of Object.values(votes)) {
    counts.set(targetId, (counts.get(targetId) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = -1;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Every alive player is a valid target, including fellow wolves and the
 * voting wolf's own self — the pack can choose to "eat" one of its own
 * (or an individual wolf can pick themselves) as a deliberate misdirection
 * play, same as any human-moderated game would allow. Nothing downstream
 * (DeathQueue, VictoryConditions) assumes a wolf can only die to the
 * village, so this needed no other changes.
 */
export function wolfKillEligibleTargetIds(ctx: EngineContext): string[] {
  return ctx.getAlivePlayers().map((p) => p.id);
}

export function applyWolfKillVote(ctx: EngineContext, actor: InternalPlayer, action: NightActionSubmitted): void {
  if (action.actionType !== "KILL_VOTE" || !action.targetId) return;
  const scratch = ctx.state.nightScratch!;
  scratch.wolfVotes[actor.id] = action.targetId;
  scratch.wolfTargetId = tallyMajority(scratch.wolfVotes);
}

export function resolveWolfKillVote(ctx: EngineContext): void {
  const scratch = ctx.state.nightScratch!;
  scratch.wolfTargetId = tallyMajority(scratch.wolfVotes);
}

export function buildWolfKillPrompt(ctx: EngineContext): NightActionRequest {
  return {
    actionType: "KILL_VOTE",
    eligibleTargetIds: wolfKillEligibleTargetIds(ctx),
    context: { currentVotes: ctx.state.nightScratch?.wolfVotes ?? {} },
  };
}
