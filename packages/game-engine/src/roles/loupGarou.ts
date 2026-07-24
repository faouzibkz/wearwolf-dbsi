import type { RoleModule } from "./Role";
import { applyWolfKillVote, buildWolfKillPrompt, resolveWolfKillVote } from "./wolfPack";

export const loupGarouRole: RoleModule = {
  id: "LOUP_GAROU",
  team: "LOUPS",
  nightPriority: 30,

  isActiveOnNight: () => true,

  buildNightPrompt(ctx) {
    return buildWolfKillPrompt(ctx);
  },

  applyNightAction(ctx, actor, action) {
    applyWolfKillVote(ctx, actor, action);
  },

  resolve(ctx) {
    resolveWolfKillVote(ctx);
  },
};
