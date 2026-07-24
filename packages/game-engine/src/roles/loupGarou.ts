import type { RoleModule } from "./Role";

function tallyMajority(votes: Record<string, string>): string | null {
  const counts = new Map<string, number>();
  for (const targetId of Object.values(votes)) {
    counts.set(targetId, (counts.get(targetId) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = -1;
  let tie = false;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
      tie = false;
    } else if (count === bestCount) {
      tie = true;
    }
  }
  // On an unresolved tie among wolves, no consensus target is picked for
  // this vote snapshot; the engine keeps waiting for votes to converge or
  // the night timer to expire (in which case the last leading pick stands).
  return tie ? best : best;
}

export const loupGarouRole: RoleModule = {
  id: "LOUP_GAROU",
  team: "LOUPS",
  nightPriority: 30,

  isActiveOnNight: () => true,

  buildNightPrompt(ctx, player) {
    const eligible = ctx
      .getAlivePlayers()
      .filter((p) => p.roleId !== "LOUP_GAROU" && p.roleId !== "LOUP_BLANC")
      .map((p) => p.id);
    return {
      actionType: "KILL_VOTE",
      eligibleTargetIds: eligible,
      context: { currentVotes: ctx.state.nightScratch?.wolfVotes ?? {} },
    };
  },

  applyNightAction(ctx, actor, action) {
    if (action.actionType !== "KILL_VOTE" || !action.targetId) return;
    const scratch = ctx.state.nightScratch!;
    scratch.wolfVotes[actor.id] = action.targetId;
    scratch.wolfTargetId = tallyMajority(scratch.wolfVotes);
  },

  resolve(ctx) {
    const scratch = ctx.state.nightScratch!;
    scratch.wolfTargetId = tallyMajority(scratch.wolfVotes);
  },
};
