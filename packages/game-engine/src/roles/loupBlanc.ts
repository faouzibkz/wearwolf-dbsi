import type { LoupBlancRule } from "@loupgarou/shared";
import type { RoleModule } from "./Role";

/**
 * Loup blanc behaviour is configurable (every night / every second night /
 * specific nights) per the spec. When active, classic rules let the Loup
 * blanc devour a fellow wolf — this is the default implementation; the
 * `isActiveOnNight` gate is the extension point for future custom rules
 * (just branch on `ctx.state.config.loupBlancRule.mode`).
 */
function isNightActive(rule: LoupBlancRule, nightNumber: number): boolean {
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
  nightPriority: 35, // after the wolves' regular vote, independent target pool

  isActiveOnNight(ctx, nightNumber) {
    return isNightActive(ctx.state.config.loupBlancRule, nightNumber);
  },

  buildNightPrompt(ctx, player) {
    const eligible = ctx
      .getAlivePlayers()
      .filter((p) => p.id !== player.id && p.roleId === "LOUP_GAROU")
      .map((p) => p.id);
    if (eligible.length === 0) return null;
    return { actionType: "DEVOUR_WOLF", eligibleTargetIds: eligible };
  },

  applyNightAction(ctx, actor, action) {
    if (action.actionType !== "DEVOUR_WOLF") return;
    const scratch = ctx.state.nightScratch!;
    scratch.loupBlancActive = true;
    scratch.loupBlancTargetId = action.targetId ?? null;
  },
};
