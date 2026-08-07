import type { RoleModule } from "./Role";
import { applyWolfKillVote, buildWolfKillPrompt, resolveWolfKillVote } from "./wolfPack";

/**
 * The Loup Vert plays as a completely ordinary member of the pack for the
 * shared kill vote (shared wolfVotes/wolfTargetId scratch via wolfPack.ts,
 * same as loupGarou.ts/loupBlanc.ts) — that part of his night is handled
 * here, through the standard RoleModule channel, exactly like any other
 * wolf.
 *
 * His SECOND power — guessing a villager's role from night 2 on, and
 * borrowing whatever he correctly guesses — is deliberately NOT modeled
 * here. A player can only have one "pending" prompt at a time in the
 * standard buildNightPrompt/applyNightAction system, but the Loup Vert
 * needs up to three independent things available the same night (the pack
 * vote, his guess, and possibly a borrowed power). See engine/LoupVert.ts
 * and the dedicated LOUP_VERT_GUESS_* / LOUP_VERT_STOLEN_POWER_* socket
 * events for that half of his mechanic.
 */
export const loupVertRole: RoleModule = {
  id: "LOUP_VERT",
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
