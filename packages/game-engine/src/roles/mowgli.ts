import type { RoleModule } from "./Role";

/**
 * Mowgli starts as a Villageois. On night 1 only, he secretly picks a
 * "father". The chosen player is never notified. If the father ever dies,
 * Mowgli permanently becomes a Loup-garou (handled centrally in
 * GameEngine.checkMowgliTransformations, which runs after every death so it
 * catches night attacks, day-vote eliminations and Chasseur shots alike).
 */
export const mowgliRole: RoleModule = {
  id: "MOWGLI",
  team: "VILLAGE", // Mowgli's team is VILLAGE until/unless he transforms
  nightPriority: 5, // resolves early, informational only, no interaction with attack resolution

  isActiveOnNight(ctx, nightNumber) {
    return nightNumber === 1;
  },

  buildNightPrompt(ctx, player) {
    if (player.mowgliFatherId) return null;
    const eligible = ctx.getAlivePlayers().filter((p) => p.id !== player.id).map((p) => p.id);
    return { actionType: "CHOOSE_FATHER", eligibleTargetIds: eligible };
  },

  applyNightAction(ctx, actor, action) {
    if (action.actionType !== "CHOOSE_FATHER" || !action.targetId) return;
    if (actor.mowgliFatherId) return; // already chosen, immutable
    actor.mowgliFatherId = action.targetId;
    ctx.state.nightScratch!.mowgliFatherChosen = true;
  },
};
