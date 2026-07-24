import type { RoleModule } from "./Role";
import { applyWolfKillVote, buildWolfKillPrompt, resolveWolfKillVote } from "./wolfPack";

/**
 * The Loup Blanc plays as a completely ordinary Loup-Garou: he joins the
 * pack's regular kill vote every night (shared wolfVotes/wolfTargetId
 * scratch via wolfPack.ts, same as loupGarou.ts) and has no special power
 * of his own. His only distinguishing trait is external to this file: the
 * Voyante's inspection of him has a one-time "cover" (see voyante.ts) —
 * her first-ever check of him reads as villageois, and only a second
 * check exposes him as a wolf.
 */
export const loupBlancRole: RoleModule = {
  id: "LOUP_BLANC",
  team: "LOUPS",
  nightPriority: 30, // same priority as the regular wolves' vote

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
