import type { RoleModule } from "./Role";

export const corbeauRole: RoleModule = {
  id: "CORBEAU",
  team: "VILLAGE",
  nightPriority: 50,

  isActiveOnNight: () => true,

  buildNightPrompt(ctx, player) {
    const eligible = ctx.getAlivePlayers().filter((p) => p.id !== player.id).map((p) => p.id);
    return { actionType: "MARK", eligibleTargetIds: eligible };
  },

  applyNightAction(ctx, actor, action) {
    if (action.actionType !== "MARK" || !action.targetId) return;
    ctx.state.nightScratch!.corbeauMarkTargetId = action.targetId;
  },

  resolve(ctx) {
    const scratch = ctx.state.nightScratch!;
    ctx.state.corbeauMarkedPlayerId = scratch.corbeauMarkTargetId;
  },
};
