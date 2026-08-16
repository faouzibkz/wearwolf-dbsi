import { ROLE_METADATA } from "@loupgarou/shared";
import type { RoleModule } from "./Role";
import { processDeaths } from "../engine/DeathQueue";

/**
 * The Prêtre ("Priest") is a Village-team role with a single, one-shot
 * power usable on any night HE chooses — available starting night 1 (no
 * waiting period, unlike the Loup Vert's guess), never mandatory: he may
 * skip it any night and keep it in reserve for later, exactly once per
 * game total once actually used.
 *
 * When he acts, he shoots one alive player of his choice — including
 * himself, deliberately (a Prêtre who suspects he's the only hope left, or
 * who simply wants to test his own faith, is allowed to aim at himself):
 *  - If the target is on the LOUPS team: the target dies. The Prêtre
 *    survives and keeps playing normally for the rest of the game.
 *  - If the target is NOT a wolf (a fellow villager, the Alien, or
 *    himself): the target is left completely untouched — the Prêtre
 *    himself is the ONLY one who dies. This is deliberately NOT a
 *    Barbie-style double-death; a wrong shot costs exactly one life, his
 *    own.
 *
 * Both outcomes funnel through the same central `processDeaths` every
 * other death in the game uses (see DeathQueue.ts), so the standard
 * reveal-on-death mechanic (role made public, cause staying admin-only
 * forever) applies automatically here with no special-casing — exactly
 * the same guarantee alien.ts's ALIEN_GUESS_CORRECT path relies on, which
 * is the template this module mirrors.
 *
 * Automatically stealable by the Loup Vert with no special-casing either:
 * engine/LoupVert.ts's stolen-power channel calls buildNightPrompt/
 * applyNightAction generically against the stripped victim's own player
 * object (where `pretreShotUsed` still lives), so a Loup Vert who
 * correctly guesses PRETRE just works, the same way it already does for
 * every other Village role.
 */
export const pretreRole: RoleModule = {
  id: "PRETRE",
  team: "VILLAGE",
  nightPriority: 12,

  isActiveOnNight: () => true,

  buildNightPrompt(ctx, player) {
    // One-shot, already spent — nothing more to offer him, ever again.
    if (player.pretreShotUsed) return null;
    // Deliberately includes his own id (see doc comment above) — the one
    // meaningful difference from alien.ts's otherwise-identical eligible
    // list, which excludes the actor.
    const eligible = ctx.getAlivePlayers().map((p) => p.id);
    return {
      actionType: "PRETRE_SHOOT",
      eligibleTargetIds: eligible,
      context: {},
    };
  },

  applyNightAction(ctx, actor, action) {
    if (action.actionType !== "PRETRE_SHOOT" || !action.targetId) return; // SKIP or invalid — power stays available for a later night
    if (actor.pretreShotUsed) return; // defensive: buildNightPrompt already hides the prompt once used

    actor.pretreShotUsed = true;
    const target = ctx.getPlayer(action.targetId);
    const hitWolf = ROLE_METADATA[target.roleId].team === "LOUPS";

    const night = ctx.state.nightScratch?.nightNumber ?? ctx.state.nightNumber;
    ctx.recordEvent({
      type: "PRETRE_SHOT",
      night,
      actorId: actor.id,
      targetId: target.id,
      targetRoleId: target.roleId,
      hitWolf,
    });

    if (hitWolf) {
      processDeaths(ctx, [{ playerId: target.id, cause: "PRETRE_SHOT_WOLF" }]);
    } else {
      // Includes the self-target case: actor.id === target.id here just
      // kills the actor, which is exactly the intended outcome.
      processDeaths(ctx, [{ playerId: actor.id, cause: "PRETRE_MISFIRE" }]);
    }
  },
};
