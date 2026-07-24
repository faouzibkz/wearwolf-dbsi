import type { LoupBlancRule } from "@loupgarou/shared";
import type { RoleModule } from "./Role";
import { applyWolfKillVote, wolfKillEligibleTargetIds } from "./wolfPack";

/**
 * The Loup Blanc is a wolf first: every night he joins the pack's regular
 * kill vote exactly like any other Loup-Garou (shared wolfVotes/wolfTargetId
 * scratch via wolfPack.ts) — this is what lets him keep killing villagers
 * even after every regular Loup-Garou has died, including when he's the
 * only wolf left alive. On top of that, depending on the configured rule,
 * some nights he may ALSO secretly devour a fellow wolf instead.
 */
function isDevourNightActive(rule: LoupBlancRule, nightNumber: number): boolean {
  switch (rule.mode) {
    case "EVERY_NIGHT":
      return true;
    case "EVERY_SECOND_NIGHT":
      return nightNumber % 2 === 0;
    case "SPECIFIC_NIGHTS":
      return rule.nights.includes(nightNumber);
    default:
      return false;
  }
}

export const loupBlancRole: RoleModule = {
  id: "LOUP_BLANC",
  team: "LOUPS",
  nightPriority: 32, // right after the regular wolves' vote

  // Always active: at minimum he has the pack kill vote every night, even
  // on nights his solo devour power is dormant.
  isActiveOnNight: () => true,

  buildNightPrompt(ctx, player) {
    const killEligible = wolfKillEligibleTargetIds(ctx);
    const nightNumber = ctx.state.nightScratch!.nightNumber;
    const devourEligible = isDevourNightActive(ctx.state.config.loupBlancRule, nightNumber)
      ? ctx.getAlivePlayers().filter((p) => p.id !== player.id && p.roleId === "LOUP_GAROU").map((p) => p.id)
      : [];

    return {
      actionType: "LOUP_BLANC_ACT",
      eligibleTargetIds: [...killEligible, ...devourEligible],
      context: {
        killEligible,
        devourEligible,
        currentVotes: ctx.state.nightScratch?.wolfVotes ?? {},
      },
    };
  },

  applyNightAction(ctx, actor, action) {
    if (action.actionType === "KILL_VOTE") {
      applyWolfKillVote(ctx, actor, action);
    } else if (action.actionType === "DEVOUR_WOLF" && action.targetId) {
      const scratch = ctx.state.nightScratch!;
      scratch.loupBlancActive = true;
      scratch.loupBlancTargetId = action.targetId;
    }
  },
};
