import type { RoleModule } from "./Role";

/**
 * Salvateur protects one player per night. The engine enforces "never the
 * same player two nights in a row" by excluding `salvateurLastProtectedId`
 * from the eligible target list — this makes the rule impossible to
 * violate from the client, since the client only ever sees legal targets.
 */
export const salvateurRole: RoleModule = {
  id: "SALVATEUR",
  team: "VILLAGE",
  nightPriority: 10, // protection must be known before the wolves' attack resolves

  isActiveOnNight: () => true,

  buildNightPrompt(ctx, player) {
    const eligible = ctx
      .getAlivePlayers()
      .filter((p) => p.id !== player.salvateurLastProtectedId)
      .map((p) => p.id);
    return { actionType: "PROTECT", eligibleTargetIds: eligible };
  },

  applyNightAction(ctx, actor, action) {
    if (action.actionType !== "PROTECT" || !action.targetId) return;
    if (action.targetId === actor.salvateurLastProtectedId) return; // guard, should never happen
    ctx.state.nightScratch!.salvateurProtectedId = action.targetId;
  },

  resolve(ctx) {
    const scratch = ctx.state.nightScratch!;
    const salvateur = ctx.getAliveByRole("SALVATEUR")[0];
    if (salvateur) {
      salvateur.salvateurLastProtectedId = scratch.salvateurProtectedId;
    }
  },
};
