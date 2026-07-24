import type { RoleModule } from "./Role";

export const voyanteRole: RoleModule = {
  id: "VOYANTE",
  team: "VILLAGE",
  nightPriority: 20,

  isActiveOnNight: () => true,

  buildNightPrompt(ctx, player) {
    const eligible = ctx.getAlivePlayers().filter((p) => p.id !== player.id).map((p) => p.id);
    return { actionType: "INSPECT", eligibleTargetIds: eligible };
  },

  applyNightAction(ctx, actor, action) {
    if (action.actionType !== "INSPECT" || !action.targetId) return;
    const target = ctx.getPlayer(action.targetId);
    const result = target.roleId === "LOUP_GAROU" || target.roleId === "LOUP_BLANC" ? "LOUP" : "NON_LOUP";
    ctx.state.nightScratch!.voyanteInspections.push({
      voyanteId: actor.id,
      targetId: action.targetId,
      result,
    });
  },
};
