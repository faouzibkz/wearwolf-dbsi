import type { EngineContext, InternalPlayer, NightScratch } from "../internalTypes";
import { getRolesByNightPriority, ROLE_REGISTRY } from "../roles/registry";
import type { NightActionRequest } from "../roles/Role";
import { processDeaths } from "./DeathQueue";

export function createNightScratch(nightNumber: number): NightScratch {
  return {
    nightNumber,
    salvateurProtectedId: null,
    wolfVotes: {},
    wolfTargetId: null,
    loupBlancActive: false,
    loupBlancTargetId: null,
    sorciereHealedTonight: false,
    sorcierePoisonedTargetId: null,
    sorciereHasActed: false,
    voyanteInspections: [],
    corbeauMarkTargetId: null,
    mowgliFatherChosen: false,
    submittedActions: {},
    deaths: [],
  };
}

/** Roles that are "in play" tonight (someone alive holds them and the role is active). */
export function getActiveNightRoles(ctx: EngineContext, nightNumber: number) {
  return getRolesByNightPriority().filter((role) => {
    if (!role.isActiveOnNight(ctx, nightNumber)) return false;
    return ctx.getAliveByRole(role.id).length > 0;
  });
}

/** Prompts for every player who has something to do tonight — used by the server to push `night:prompt`. */
export function collectNightPrompts(
  ctx: EngineContext,
  nightNumber: number,
): { player: InternalPlayer; request: NightActionRequest }[] {
  const prompts: { player: InternalPlayer; request: NightActionRequest }[] = [];
  for (const role of getActiveNightRoles(ctx, nightNumber)) {
    for (const player of ctx.getAliveByRole(role.id)) {
      const request = role.buildNightPrompt?.(ctx, player);
      if (request) prompts.push({ player, request });
    }
  }
  return prompts;
}

export function submitNightAction(
  ctx: EngineContext,
  playerId: string,
  actionType: string,
  targetId?: string,
): void {
  const player = ctx.getPlayer(playerId);
  if (!player.isAlive) throw new Error("Un joueur mort ne peut pas agir.");
  const role = ROLE_REGISTRY[player.roleId];
  if (!role.applyNightAction) throw new Error("Ce rôle n'a pas d'action de nuit.");
  const scratch = ctx.state.nightScratch;
  if (!scratch) throw new Error("Aucune nuit en cours.");
  scratch.submittedActions[playerId] = { playerId, actionType, targetId };
  role.applyNightAction(ctx, player, { playerId, actionType, targetId });
}

/**
 * Runs every active role's `resolve()` in priority order, then applies the
 * combined effect of the wolf attack (minus protection/heal), the Loup
 * blanc attack and the Sorcière's poison, and finally checks for Mowgli
 * transformations + pending Chasseur shots via the shared death queue.
 */
export function resolveNight(ctx: EngineContext, nightNumber: number): { anyoneDied: boolean } {
  for (const role of getActiveNightRoles(ctx, nightNumber)) {
    role.resolve?.(ctx);
  }

  const scratch = ctx.state.nightScratch!;
  const deaths: { playerId: string; cause: string }[] = [];

  const wolfTarget = scratch.wolfTargetId;
  if (wolfTarget) {
    const saved = scratch.salvateurProtectedId === wolfTarget || scratch.sorciereHealedTonight;
    if (!saved) deaths.push({ playerId: wolfTarget, cause: "LOUP_GAROU_ATTACK" });
  }
  if (scratch.loupBlancTargetId) {
    deaths.push({ playerId: scratch.loupBlancTargetId, cause: "LOUP_BLANC_ATTACK" });
  }
  if (scratch.sorcierePoisonedTargetId) {
    deaths.push({ playerId: scratch.sorcierePoisonedTargetId, cause: "SORCIERE_POISON" });
  }

  const dedupedDeaths = deaths.filter(
    (d, i) => deaths.findIndex((other) => other.playerId === d.playerId) === i,
  );

  const actuallyDied = processDeaths(ctx, dedupedDeaths);
  scratch.deaths = actuallyDied;

  return { anyoneDied: actuallyDied.length > 0 };
}
