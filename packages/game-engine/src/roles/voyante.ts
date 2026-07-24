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
    const timesInspected = (actor.voyanteInspectionCounts[action.targetId] ?? 0) + 1;
    actor.voyanteInspectionCounts[action.targetId] = timesInspected;

    let result: "LOUP" | "NON_LOUP";
    if (target.roleId === "LOUP_BLANC") {
      // House rule: the Loup Blanc's cover holds on the Voyante's first
      // inspection of him (shown as a villager); a second inspection of
      // that same player is what reveals him as a wolf.
      result = timesInspected >= 2 ? "LOUP" : "NON_LOUP";
    } else {
      result = target.roleId === "LOUP_GAROU" ? "LOUP" : "NON_LOUP";
    }

    ctx.state.nightScratch!.voyanteInspections.push({
      voyanteId: actor.id,
      targetId: action.targetId,
      result,
    });
  },
};
