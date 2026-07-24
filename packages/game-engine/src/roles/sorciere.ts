import type { RoleModule } from "./Role";

/**
 * The Sorcière is only prompted once the wolves' target for the night is
 * known (nightPriority runs after LOUP_GAROU). She may use the healing
 * potion (saves the wolves' victim), the poison potion (kills any other
 * living player), both, or neither — each potion is usable once per game.
 */
export const sorciereRole: RoleModule = {
  id: "SORCIERE",
  team: "VILLAGE",
  nightPriority: 40,

  isActiveOnNight: () => true,

  buildNightPrompt(ctx, player) {
    if (player.sorciereHealUsed && player.sorcierePoisonUsed) return null;
    const scratch = ctx.state.nightScratch!;
    const attackedId = scratch.wolfTargetId;
    const poisonTargets = ctx
      .getAlivePlayers()
      .filter((p) => p.id !== player.id)
      .map((p) => p.id);
    return {
      actionType: "SORCIERE_ACT",
      eligibleTargetIds: poisonTargets,
      context: {
        attackedPlayerId: player.sorciereHealUsed ? null : attackedId,
        canHeal: !player.sorciereHealUsed && Boolean(attackedId),
        canPoison: !player.sorcierePoisonUsed,
      },
    };
  },

  applyNightAction(ctx, actor, action) {
    const scratch = ctx.state.nightScratch!;
    if (action.actionType === "HEAL" && !actor.sorciereHealUsed && scratch.wolfTargetId) {
      actor.sorciereHealUsed = true;
      scratch.sorciereHealedTonight = true;
      scratch.sorciereHasActed = true;
    } else if (action.actionType === "POISON" && !actor.sorcierePoisonUsed && action.targetId) {
      actor.sorcierePoisonUsed = true;
      scratch.sorcierePoisonedTargetId = action.targetId;
      scratch.sorciereHasActed = true;
    }
    // SKIP or invalid actions leave scratch untouched.
  },
};
