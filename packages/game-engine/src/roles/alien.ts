import type { RoleId } from "@loupgarou/shared";
import { ROLE_IDS, ROLE_METADATA } from "@loupgarou/shared";
import type { RoleModule } from "./Role";
import { processDeaths } from "../engine/DeathQueue";

/** Every guessable role except ALIEN itself (there's only ever one Alien). */
const GUESSABLE_ROLE_IDS: RoleId[] = ROLE_IDS.filter((id) => id !== "ALIEN");

function isWolfRole(roleId: RoleId): boolean {
  return ROLE_METADATA[roleId].team === "LOUPS";
}

/**
 * The Alien is a lone third faction: not Village, not Loups. Each night he
 * may guess a target's exact role, using the standard one-action-per-night
 * NightResolver machinery (so at most once per night).
 *
 * Whether that guess is optional or mandatory depends on how the night was
 * reached (house rule, on top of the base cahier de charge):
 *  - A night reached normally (day discussion ran its course, or the timer
 *    fired) leaves him free to guess or skip, same as any other role that
 *    can pass.
 *  - A night HE forced early via GameEngine.triggerAlienNightfall (cutting
 *    the day's debate short) obligates him to guess someone that same
 *    night — see scratch.alienForcedNightfall. Otherwise cutting the debate
 *    short would be a strictly dominant free action with no downside
 *    (skip the risk of a bad guess, still deprive the village of debate
 *    time), which defeats the point of giving him the power at all.
 *
 *  - Correct: the target dies immediately (via the same DeathQueue every
 *    other death funnels through — see DeathQueue.ts — so it's revealed
 *    publicly with the target's real role, exactly like any other death,
 *    with no hint that the Alien was involved).
 *  - Wrong: he loses one "chance" from whichever pool matches the
 *    CATEGORY of role he guessed (2 chances total against village-team
 *    roles, 1 against wolf-team roles — see internalTypes.ts's
 *    alienVillageChancesLeft/alienWolfChancesLeft). If that pool was
 *    already at zero, this wrong guess kills him instead.
 *
 * He never wins on his own — see VictoryConditions.ts, which deliberately
 * excludes him from both the wolf-parity and all-wolves-dead counts so his
 * presence never changes who wins between Village and Loups.
 */
export const alienRole: RoleModule = {
  id: "ALIEN",
  team: "SOLO",
  nightPriority: 15,

  isActiveOnNight: () => true,

  buildNightPrompt(ctx, player) {
    const eligible = ctx.getAlivePlayers().filter((p) => p.id !== player.id).map((p) => p.id);
    return {
      actionType: "ALIEN_GUESS",
      eligibleTargetIds: eligible,
      context: {
        guessableRoleIds: GUESSABLE_ROLE_IDS,
        villageChancesLeft: player.alienVillageChancesLeft,
        wolfChancesLeft: player.alienWolfChancesLeft,
        mustGuess: ctx.state.nightScratch?.alienForcedNightfall === true,
      },
    };
  },

  applyNightAction(ctx, actor, action) {
    if (action.actionType !== "ALIEN_GUESS" || !action.targetId || !action.guessedRoleId) {
      if (ctx.state.nightScratch?.alienForcedNightfall === true) {
        throw new Error(
          "Vous avez précipité la nuit : vous devez deviner le rôle d'un joueur cette nuit-là.",
        );
      }
      return;
    }
    const target = ctx.getPlayer(action.targetId);
    const guessedRoleId = action.guessedRoleId;
    const guessedWolf = isWolfRole(guessedRoleId);
    const correct = target.roleId === guessedRoleId;

    const night = ctx.state.nightScratch?.nightNumber ?? ctx.state.nightNumber;
    ctx.recordEvent({
      type: "ALIEN_GUESS",
      night,
      actorId: actor.id,
      targetId: target.id,
      guessedRoleId,
      correct,
    });

    if (correct) {
      actor.alienLastGuessResult = "CORRECT";
      processDeaths(ctx, [{ playerId: target.id, cause: "ALIEN_GUESS_CORRECT" }]);
      return;
    }

    actor.alienLastGuessResult = "WRONG";
    const chancesLeft = guessedWolf ? actor.alienWolfChancesLeft : actor.alienVillageChancesLeft;
    if (chancesLeft > 0) {
      if (guessedWolf) actor.alienWolfChancesLeft -= 1;
      else actor.alienVillageChancesLeft -= 1;
    } else {
      // That category's pool was already empty — this miss is fatal.
      processDeaths(ctx, [{ playerId: actor.id, cause: "ALIEN_OUT_OF_CHANCES" }]);
    }
  },
};
