import type { RoleId } from "@loupgarou/shared";
import { ROLE_METADATA } from "@loupgarou/shared";
import type { EngineContext, InternalPlayer, NightScratch } from "../internalTypes";
import { getRolesByNightPriority, ROLE_REGISTRY } from "../roles/registry";
import type { NightActionRequest } from "../roles/Role";
import { processDeaths } from "./DeathQueue";

export function createNightScratch(nightNumber: number, alienForcedNightfall = false): NightScratch {
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
    alienForcedNightfall,
    // Populated right after this by GameEngine.startNight() when
    // config.nightMode is SEQUENTIAL (see NightSequencer.ts) — left empty
    // here since createNightScratch has no EngineContext to compute them
    // from yet, and they're simply never read in SIMULTANEOUS mode.
    sequentialSteps: [],
    sequentialStepIndex: 0,
  };
}

/** Roles that are "in play" tonight (someone alive holds them and the role is active). */
export function getActiveNightRoles(ctx: EngineContext, nightNumber: number) {
  return getRolesByNightPriority().filter((role) => {
    if (!role.isActiveOnNight(ctx, nightNumber)) return false;
    return ctx.getAliveByRole(role.id).length > 0;
  });
}

/**
 * Prompts for every player who has something to do tonight — used by the
 * server to push `night:prompt`.
 *
 * `onlyPending` (default true) excludes anyone who has already submitted an
 * action this night (tracked in `scratch.submittedActions`, set the instant
 * `submitNightAction` runs — including a no-op "SKIP"). This matters
 * because the server re-pushes prompts whenever a *later* role's context
 * needs refreshing (e.g. the Sorcière needs to see the wolves' locked-in
 * target once it's known) — without this filter, that re-push would also
 * re-open the prompt for roles who already acted (e.g. the wolves
 * themselves), popping their target-selection screen back up for no reason.
 * Pass `onlyPending: false` to get the full roster regardless of submission
 * state (e.g. for admin/debug views).
 */
export function collectNightPrompts(
  ctx: EngineContext,
  nightNumber: number,
  onlyPending = true,
): { player: InternalPlayer; request: NightActionRequest }[] {
  const scratch = ctx.state.nightScratch;
  const prompts: { player: InternalPlayer; request: NightActionRequest }[] = [];
  for (const role of getActiveNightRoles(ctx, nightNumber)) {
    for (const player of ctx.getAliveByRole(role.id)) {
      if (onlyPending && scratch?.submittedActions[player.id]) continue;
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
  guessedRoleId?: RoleId,
): void {
  const player = ctx.getPlayer(playerId);
  if (!player.isAlive) throw new Error("Un joueur mort ne peut pas agir.");
  const role = ROLE_REGISTRY[player.roleId];
  if (!role.applyNightAction) throw new Error("Ce rôle n'a pas d'action de nuit.");
  const scratch = ctx.state.nightScratch;
  if (!scratch) throw new Error("Aucune nuit en cours.");
  // Apply first, record second: a role that rejects the action (e.g. the
  // Alien refusing a "SKIP" on a night he forced himself — see
  // roles/alien.ts) must throw BEFORE this player is marked as having
  // acted tonight, otherwise collectNightPrompts' onlyPending filter would
  // hide their prompt forever despite no valid action ever having landed.
  role.applyNightAction(ctx, player, { playerId, actionType, targetId, guessedRoleId });
  scratch.submittedActions[playerId] = { playerId, actionType, targetId, guessedRoleId };
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

  recordNightEvents(ctx, scratch, wolfTarget, actuallyDied);

  return { anyoneDied: actuallyDied.length > 0 };
}

/**
 * Builds this night's structured events (see events.ts's GameEvent) from
 * the same `scratch` data resolveNight just used to compute deaths — a
 * single centralized place rather than instrumenting every role module
 * individually, since almost every one of these outcomes (a protection
 * that "worked", a heal that "saved", a poison that "killed a wolf") can
 * only actually be known once the whole night's resolution has run, not at
 * the moment each role submitted their action. Runs exactly once per night
 * (resolveNight is never called twice for the same night — see
 * GameEngine.resolveNightAndProceed's doc comment), so there's no risk of
 * double-recording.
 */
function recordNightEvents(
  ctx: EngineContext,
  scratch: NightScratch,
  wolfTarget: string | null,
  actuallyDied: string[],
): void {
  const night = scratch.nightNumber;

  for (const inspection of scratch.voyanteInspections) {
    ctx.recordEvent({
      type: "VOYANTE_INSPECT",
      night,
      actorId: inspection.voyanteId,
      targetId: inspection.targetId,
      targetRoleId: ctx.getPlayer(inspection.targetId).roleId,
      result: inspection.result,
    });
  }

  if (scratch.salvateurProtectedId) {
    const salvateur = ctx.getAliveByRole("SALVATEUR")[0];
    if (salvateur) {
      ctx.recordEvent({
        type: "SALVATEUR_PROTECT",
        night,
        actorId: salvateur.id,
        targetId: scratch.salvateurProtectedId,
        saved: scratch.salvateurProtectedId === wolfTarget,
      });
    }
  }

  if (scratch.sorciereHealedTonight && wolfTarget) {
    const sorciere = ctx.getAliveByRole("SORCIERE")[0];
    if (sorciere) {
      ctx.recordEvent({ type: "SORCIERE_HEAL", night, actorId: sorciere.id, targetId: wolfTarget });
    }
  }

  if (scratch.sorcierePoisonedTargetId) {
    const sorciere = ctx.getAliveByRole("SORCIERE")[0];
    if (sorciere) {
      const targetRoleId = ctx.getPlayer(scratch.sorcierePoisonedTargetId).roleId;
      ctx.recordEvent({
        type: "SORCIERE_POISON",
        night,
        actorId: sorciere.id,
        targetId: scratch.sorcierePoisonedTargetId,
        targetRoleId,
        killedWolf: ROLE_METADATA[targetRoleId].team === "LOUPS",
      });
    }
  }

  if (wolfTarget) {
    ctx.recordEvent({
      type: "WOLF_KILL_ATTEMPT",
      night,
      targetId: wolfTarget,
      landed: actuallyDied.includes(wolfTarget),
    });
  }

  if (scratch.loupBlancTargetId) {
    ctx.recordEvent({
      type: "WOLF_KILL_ATTEMPT",
      night,
      targetId: scratch.loupBlancTargetId,
      landed: actuallyDied.includes(scratch.loupBlancTargetId),
    });
  }

  if (scratch.corbeauMarkTargetId) {
    const corbeau = ctx.getAliveByRole("CORBEAU")[0];
    if (corbeau) {
      ctx.recordEvent({
        type: "CORBEAU_MARK",
        night,
        actorId: corbeau.id,
        targetId: scratch.corbeauMarkTargetId,
      });
    }
  }
}
